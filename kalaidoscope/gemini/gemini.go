package gemini

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/httpx"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// geminiBase is a variable so a test can point the provider at a fake server.
var geminiBase = "https://generativelanguage.googleapis.com/v1beta"

// Demo 2026-08-27: every request rides the Priority tier. Make this
// configurable (kalaidoscope_config) when the demo hardcode is lifted.
// Requests beyond the account's priority limits are served at the standard
// tier rather than failing; usageMetadata.trafficType reports which tier
// actually served the request.
const serviceTier = "priority"

type Provider struct {
	Model string
	// APIKey is the workspace's own BYOK credential. When empty the process
	// environment is used instead, which is how the managed cloud deployment
	// and any pre-BYOK workspace still authenticate.
	APIKey string
}

func (p *Provider) model() string {
	return p.Model
}

func (p *Provider) ContextWindow() int {
	return 1_000_000
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiFunctionCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type geminiPart struct {
	Text         string              `json:"text,omitempty"`
	FunctionCall *geminiFunctionCall `json:"functionCall,omitempty"`
}

type geminiFunctionDeclaration struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type geminiTool struct {
	FunctionDeclarations []geminiFunctionDeclaration `json:"functionDeclarations"`
}

type geminiGenerationConfig struct {
	Temperature *float64 `json:"temperature,omitempty"`
}

type geminiRequest struct {
	Contents          []geminiContent         `json:"contents"`
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	Tools             []geminiTool            `json:"tools,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
	ServiceTier       string                  `json:"service_tier,omitempty"`
}

type geminiStreamChunk struct {
	Candidates []struct {
		Content struct {
			Parts []geminiPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	UsageMetadata *struct {
		PromptTokenCount        int    `json:"promptTokenCount"`
		CandidatesTokenCount    int    `json:"candidatesTokenCount"`
		TotalTokenCount         int    `json:"totalTokenCount"`
		CachedContentTokenCount int    `json:"cachedContentTokenCount"`
		TrafficType             string `json:"trafficType"`
	} `json:"usageMetadata"`
}

func (p *Provider) Stream(ctx context.Context, messages []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	apiKey := p.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("GEMINI_API_KEY")
	}
	if apiKey == "" {
		return nil, &llm.ProviderError{
			Provider: llm.ProviderGemini,
			Kind:     llm.ErrKindAuth,
			Model:    p.Model,
			Body:     "no API key configured (workspace key unset and GEMINI_API_KEY unset)",
		}
	}
	if p.Model == "" {
		return nil, fmt.Errorf("gemini: no model set")
	}

	// Only the leading system message is the system instruction. Every
	// caller puts its prompt there; any later system message is a context
	// delta from the hydrator (documents added or removed at that point in
	// the conversation) and rides as a user-turn part in its real position.
	// Folding those into the instruction did two wrong things: it hoisted a
	// mid-conversation notice to the top, and it grew the instruction to the
	// size of the whole context, which Gemini rejects as INVALID_ARGUMENT
	// once the workspace is large enough (~500k chars observed) — while the
	// same text as a user turn is accepted, as snapshot generation shows.
	// Consecutive same-role turns merge into one content with several parts.
	contents := make([]geminiContent, 0, len(messages))
	var systemText string
	parts := 0
	appendPart := func(role, text string) {
		parts++
		if n := len(contents); n > 0 && contents[n-1].Role == role {
			contents[n-1].Parts = append(contents[n-1].Parts, geminiPart{Text: text})
			return
		}
		contents = append(contents, geminiContent{Role: role, Parts: []geminiPart{{Text: text}}})
	}
	for i, m := range messages {
		role := m.Role
		switch role {
		case "system":
			if i == 0 {
				systemText = m.Content
				continue
			}
			role = "user"
		case "assistant":
			role = "model"
		}
		appendPart(role, m.Content)
	}

	var systemInstruction *geminiContent
	if systemText != "" {
		systemInstruction = &geminiContent{Parts: []geminiPart{{Text: systemText}}}
	}

	var gTools []geminiTool
	if len(tools) > 0 {
		decls := make([]geminiFunctionDeclaration, 0, len(tools))
		for _, t := range tools {
			decls = append(decls, geminiFunctionDeclaration{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.Parameters,
			})
		}
		gTools = []geminiTool{{FunctionDeclarations: decls}}
	}

	var genConfig *geminiGenerationConfig
	if opts.Temperature != nil {
		genConfig = &geminiGenerationConfig{Temperature: opts.Temperature}
	}

	body, err := json.Marshal(geminiRequest{
		Contents:          contents,
		SystemInstruction: systemInstruction,
		Tools:             gTools,
		GenerationConfig:  genConfig,
		ServiceTier:       serviceTier,
	})
	if err != nil {
		return nil, fmt.Errorf("gemini: marshal: %w", err)
	}

	// What the failure log reports besides the generic shape: the wire-level
	// facts Gemini validates — the tier, the folded system instruction's
	// size, and the turn count — since its 400s rarely say which one it
	// objected to.
	shape := llm.Shape(messages, tools, opts)
	detail := fmt.Sprintf("tier=%s system_instruction=%dch contents=%d parts=%d body=%dB",
		serviceTier, len(systemText), len(contents), parts, len(body))

	url := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse", geminiBase, p.model())
	llm.LogRequest(llm.ProviderGemini, p.model(), url, body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("gemini: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := httpx.Streaming().Do(req)
	if err != nil {
		// A cancelled request is the caller going away, not a provider fault —
		// leave it unclassified so it can't be mistaken for an auth failure.
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		llm.LogFailure(llm.ProviderGemini, p.model(), 0, shape, detail, err.Error())
		return nil, &llm.ProviderError{
			Provider: llm.ProviderGemini,
			Kind:     llm.ErrKindTransient,
			Model:    p.model(),
			Body:     err.Error(),
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		llm.LogFailure(llm.ProviderGemini, p.model(), resp.StatusCode, shape, detail, string(body))
		return nil, &llm.ProviderError{
			Provider:   llm.ProviderGemini,
			Kind:       classify(resp.StatusCode, body),
			StatusCode: resp.StatusCode,
			Model:      p.model(),
			Body:       strings.TrimSpace(string(body)),
		}
	}

	ch := make(chan llm.StreamEvent)
	done := make(chan struct{})
	var finalUsage *llm.Usage
	go func() {
		defer close(done)
		defer close(ch)
		defer resp.Body.Close()

		usage := llm.Usage{Provider: "gemini", Model: p.model()}
		var sawUsage bool
		var trafficType string

		activeCalls := make(map[string]string)
		completedCalls := make(map[string]bool)

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}
			var chunk geminiStreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				continue
			}
			// usageMetadata is cumulative and present on later chunks; keep the latest.
			if u := chunk.UsageMetadata; u != nil {
				usage.PromptTokens = u.PromptTokenCount
				usage.CompletionTokens = u.CandidatesTokenCount
				usage.TotalTokens = u.TotalTokenCount
				usage.CachedTokens = u.CachedContentTokenCount
				if u.TrafficType != "" {
					trafficType = u.TrafficType
				}
				sawUsage = true
			}
			if len(chunk.Candidates) == 0 {
				continue
			}
			for _, part := range chunk.Candidates[0].Content.Parts {
				if part.Text != "" {
					select {
					case ch <- llm.StreamEvent{Kind: llm.EventText, Text: part.Text}:
					case <-ctx.Done():
						return
					}
				}
				if part.FunctionCall != nil && part.FunctionCall.Name != "" {
					name := part.FunctionCall.Name
					id := activeCalls[name]
					if id == "" {
						id = fmt.Sprintf("call-%d", time.Now().UnixNano())
						activeCalls[name] = id
						select {
						case ch <- llm.StreamEvent{
							Kind:       llm.EventToolStart,
							ToolCallID: id,
							ToolName:   name,
						}:
						case <-ctx.Done():
							return
						}
					}
					if !completedCalls[name] && len(part.FunctionCall.Args) > 0 {
						select {
						case ch <- llm.StreamEvent{
							Kind:       llm.EventToolEnd,
							ToolCallID: id,
							ToolName:   name,
							Args:       part.FunctionCall.Args,
						}:
						case <-ctx.Done():
							return
						}
						completedCalls[name] = true
					}
				}
			}
		}
		if sawUsage {
			finalUsage = &usage
			// Priority overflow downgrades silently to the standard tier, so
			// this line is the only place that shows which tier actually
			// served the request (ON_DEMAND_PRIORITY vs ON_DEMAND).
			log.Printf("gemini: traffic_type=%s model=%s", trafficType, p.model())
		}
	}()

	return &llm.Completion{
		Events: ch,
		Wait:   func() *llm.Usage { <-done; return finalUsage },
	}, nil
}
