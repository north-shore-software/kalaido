package gemini

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/httpx"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// geminiBase is a variable so a test can point the provider at a fake server.
// TODO: make this user-configurable (or at least an env var)
var geminiBase = "https://generativelanguage.googleapis.com/v1beta"

// TODO: make the service tier user-configurable
const serviceTier = "priority"

type Provider struct {
	Model string
	// When empty, the process environment is used instead.
	APIKey string
}

var Descriptor = llm.ProviderDescriptor{
	ID:            llm.ProviderGemini,
	RequiresKey:   true,
	CredentialEnv: "GEMINI_API_KEY",
	New: func(model string, apiKey string) llm.Provider {
		return &Provider{Model: model, APIKey: apiKey}
	},
}

func Register() {
	llm.RegisterProvider(Descriptor)
}

func (p *Provider) model() string {
	return p.Model
}

func (p *Provider) ContextWindow() int {
	// TODO: pull this from the API, don't hardcode it
	return 1_000_000
}

func (p *Provider) Stream(ctx context.Context, messages []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	apiKey, err := p.resolveAPIKey()
	if err != nil {
		return nil, err
	}

	body, meta, err := buildRequestBody(messages, tools, opts)
	if err != nil {
		return nil, fmt.Errorf("gemini: marshal: %w", err)
	}

	resp, err := p.sendRequest(ctx, apiKey, body, meta)
	if err != nil {
		return nil, err
	}

	ch := make(chan llm.StreamEvent)
	done := make(chan struct{})
	var finalUsage *llm.Usage
	go func() {
		defer close(done)
		defer close(ch)
		defer resp.Body.Close()

		proc := newStreamProcessor(p, ctx, ch)
		finalUsage = proc.process(resp.Body, meta)
	}()

	return &llm.Completion{
		Events: ch,
		Wait:   func() *llm.Usage { <-done; return finalUsage },
	}, nil
}

func (p *Provider) resolveAPIKey() (string, error) {
	apiKey := p.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("GEMINI_API_KEY")
	}
	if apiKey == "" {
		return "", &llm.ProviderError{
			Provider: llm.ProviderGemini,
			Kind:     llm.ErrKindAuth,
			Model:    p.Model,
			Body:     "no API key configured (workspace key unset and GEMINI_API_KEY unset)",
		}
	}
	if p.Model == "" {
		return "", fmt.Errorf("gemini: no model set")
	}
	return apiKey, nil
}

type requestMeta struct {
	shape  string
	detail string
}

func buildRequestBody(messages []llm.Message, tools []llm.Tool, opts llm.GenOptions) ([]byte, requestMeta, error) {
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
		return nil, requestMeta{}, err
	}

	meta := requestMeta{
		shape: llm.Shape(messages, tools, opts),
		detail: fmt.Sprintf("tier=%s system_instruction=%dch contents=%d parts=%d body=%dB",
			serviceTier, len(systemText), len(contents), parts, len(body)),
	}

	return body, meta, nil
}

func (p *Provider) sendRequest(ctx context.Context, apiKey string, body []byte, meta requestMeta) (*http.Response, error) {
	// TODO: make this URL pattern congurable (or at least not a magic string)
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
		llm.LogFailure(llm.ProviderGemini, p.model(), 0, meta.shape, meta.detail, err.Error())
		return nil, &llm.ProviderError{
			Provider: llm.ProviderGemini,
			Kind:     llm.ErrKindTransient,
			Model:    p.model(),
			Body:     err.Error(),
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		llm.LogFailure(llm.ProviderGemini, p.model(), resp.StatusCode, meta.shape, meta.detail, string(body))
		return nil, &llm.ProviderError{
			Provider:   llm.ProviderGemini,
			Kind:       classify(resp.StatusCode, body),
			StatusCode: resp.StatusCode,
			Model:      p.model(),
			Body:       strings.TrimSpace(string(body)),
		}
	}

	return resp, nil
}

type streamProcessor struct {
	provider       *Provider
	ctx            context.Context
	ch             chan<- llm.StreamEvent
	usage          llm.Usage
	sawUsage       bool
	trafficType    string
	activeCalls    map[string]string
	completedCalls map[string]bool
	// Why the stream ended, and what it carried: written at the end when
	// the finish was not a plain STOP or nothing reached the caller, so a
	// silent completion is diagnosable from the log alone.
	finishReason  string
	finishMessage string
	blockReason   string
	textParts     int
	toolParts     int
}

func newStreamProcessor(p *Provider, ctx context.Context, ch chan<- llm.StreamEvent) *streamProcessor {
	return &streamProcessor{
		provider:       p,
		ctx:            ctx,
		ch:             ch,
		usage:          llm.Usage{Provider: "gemini", Model: p.model()},
		activeCalls:    make(map[string]string),
		completedCalls: make(map[string]bool),
	}
}

func (sp *streamProcessor) process(body io.Reader, meta requestMeta) *llm.Usage {
	scanner := bufio.NewScanner(body)
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
		if !sp.handleChunk(chunk) {
			return nil
		}
	}

	var finalUsage *llm.Usage
	if sp.sawUsage {
		finalUsage = &sp.usage
		// Priority overflow downgrades silently to the standard tier, so
		// this line is the only place that shows which tier actually
		// served the request (ON_DEMAND_PRIORITY vs ON_DEMAND).
		slog.Default().With("component", "gemini").Debug("traffic type", "traffic_type", sp.trafficType, "model", sp.provider.model())
	}

	if sp.ctx.Err() != nil {
		return finalUsage
	}

	sp.logCompletion(meta)
	return finalUsage
}

func (sp *streamProcessor) handleChunk(chunk geminiStreamChunk) bool {
	// usageMetadata is cumulative and present on later chunks; keep the latest.
	if u := chunk.UsageMetadata; u != nil {
		sp.usage.PromptTokens = u.PromptTokenCount
		sp.usage.CompletionTokens = u.CandidatesTokenCount
		sp.usage.TotalTokens = u.TotalTokenCount
		sp.usage.CachedTokens = u.CachedContentTokenCount
		if u.TrafficType != "" {
			sp.trafficType = u.TrafficType
		}
		sp.sawUsage = true
	}
	if fb := chunk.PromptFeedback; fb != nil && fb.BlockReason != "" {
		sp.blockReason = fb.BlockReason
		if fb.BlockReasonMessage != "" {
			sp.blockReason += " (" + fb.BlockReasonMessage + ")"
		}
	}
	if len(chunk.Candidates) == 0 {
		return true
	}
	if fr := chunk.Candidates[0].FinishReason; fr != "" {
		sp.finishReason = fr
		sp.finishMessage = chunk.Candidates[0].FinishMessage
	}
	for _, part := range chunk.Candidates[0].Content.Parts {
		if !sp.handlePart(part) {
			return false
		}
	}
	return true
}

func (sp *streamProcessor) handlePart(part geminiPart) bool {
	if part.Text != "" {
		sp.textParts++
		select {
		case sp.ch <- llm.StreamEvent{Kind: llm.EventText, Text: part.Text}:
		case <-sp.ctx.Done():
			return false
		}
	}
	if part.FunctionCall != nil && part.FunctionCall.Name != "" {
		name := part.FunctionCall.Name
		id := sp.activeCalls[name]
		if id == "" {
			id = fmt.Sprintf("call-%d", time.Now().UnixNano())
			sp.activeCalls[name] = id
			sp.toolParts++
			select {
			case sp.ch <- llm.StreamEvent{
				Kind:       llm.EventToolStart,
				ToolCallID: id,
				ToolName:   name,
			}:
			case <-sp.ctx.Done():
				return false
			}
		}
		if !sp.completedCalls[name] && len(part.FunctionCall.Args) > 0 {
			select {
			case sp.ch <- llm.StreamEvent{
				Kind:       llm.EventToolEnd,
				ToolCallID: id,
				ToolName:   name,
				Args:       part.FunctionCall.Args,
			}:
			case <-sp.ctx.Done():
				return false
			}
			sp.completedCalls[name] = true
		}
	}
	return true
}

func (sp *streamProcessor) logCompletion(meta requestMeta) {
	// A completion that ended abnormally, or delivered nothing, is
	// otherwise indistinguishable from a model that had nothing to say:
	// name the finish reason (MALFORMED_FUNCTION_CALL is the usual one
	// when the model reaches for a tool that was not advertised), the
	// block reason, what was emitted, what was spent, and the call's
	// shape, so one log line explains an empty turn.
	abnormal := sp.finishReason != "" && sp.finishReason != "STOP"
	if abnormal || sp.blockReason != "" || (sp.textParts == 0 && sp.toolParts == 0) {
		finishReason := sp.finishReason
		if finishReason == "" {
			finishReason = "none"
		}
		if sp.finishMessage != "" {
			finishReason += " (" + sp.finishMessage + ")"
		}
		blockReason := sp.blockReason
		if blockReason == "" {
			blockReason = "none"
		}
		slog.Default().With("component", "gemini").Warn("completion ended",
			"finish_reason", finishReason, "block_reason", blockReason, "text_parts", sp.textParts, "tool_calls", sp.toolParts,
			"completion_tokens", sp.usage.CompletionTokens, "model", sp.provider.model(), "shape", meta.shape, "detail", meta.detail)
	}
}
