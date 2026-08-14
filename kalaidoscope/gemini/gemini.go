package gemini

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/httpx"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const geminiBase = "https://generativelanguage.googleapis.com/v1beta"

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

type geminiRequest struct {
	Contents          []geminiContent `json:"contents"`
	SystemInstruction *geminiContent  `json:"systemInstruction,omitempty"`
	Tools             []geminiTool    `json:"tools,omitempty"`
}

type geminiStreamChunk struct {
	Candidates []struct {
		Content struct {
			Parts []geminiPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	UsageMetadata *struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

func (p *Provider) Stream(ctx context.Context, messages []llm.Message, tools []llm.Tool) (*llm.Completion, error) {
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

	contents := make([]geminiContent, 0, len(messages))
	var systemText strings.Builder
	for _, m := range messages {

		if m.Role == "system" {
			if systemText.Len() > 0 {
				systemText.WriteString("\n\n")
			}
			systemText.WriteString(m.Content)
			continue
		}
		role := m.Role
		if role == "assistant" {
			role = "model"
		}
		contents = append(contents, geminiContent{
			Role:  role,
			Parts: []geminiPart{{Text: m.Content}},
		})
	}

	var systemInstruction *geminiContent
	if systemText.Len() > 0 {
		systemInstruction = &geminiContent{Parts: []geminiPart{{Text: systemText.String()}}}
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

	body, err := json.Marshal(geminiRequest{
		Contents:          contents,
		SystemInstruction: systemInstruction,
		Tools:             gTools,
	})
	if err != nil {
		return nil, fmt.Errorf("gemini: marshal: %w", err)
	}

	url := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse", geminiBase, p.model())
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
		}
	}()

	return &llm.Completion{
		Events: ch,
		Wait:   func() *llm.Usage { <-done; return finalUsage },
	}, nil
}
