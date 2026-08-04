package ollama

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/httpx"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const defaultModel = "gemma4"

var Base = func() string {
	if v := os.Getenv("OLLAMA_HOST"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:11434"
}()

type OllamaProvider struct {
	Model string
}

func (p *OllamaProvider) model() string {
	if p.Model != "" {
		return p.Model
	}
	return defaultModel
}

const keepAlive = "60m"

var (
	ctxLenMu    sync.RWMutex
	ctxLenCache = make(map[string]int)
)

func GetModelContextLength(ctx context.Context, model string) int {
	ctxLenMu.RLock()
	val, ok := ctxLenCache[model]
	ctxLenMu.RUnlock()
	if ok {
		return val
	}

	defaultLen := 4096
	body, err := json.Marshal(map[string]string{"model": model})
	if err != nil {
		return defaultLen
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, Base+"/api/show", bytes.NewReader(body))
	if err != nil {
		return defaultLen
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpx.Short(5 * time.Second).Do(req)
	if err != nil {
		return defaultLen
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return defaultLen
	}

	var data struct {
		ModelInfo map[string]any `json:"model_info"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return defaultLen
	}

	ctxLen := defaultLen
	for k, v := range data.ModelInfo {
		if strings.HasSuffix(k, ".context_length") {
			if f, ok := v.(float64); ok {
				ctxLen = int(f)
			}
			break
		}
	}

	ctxLenMu.Lock()
	ctxLenCache[model] = ctxLen
	ctxLenMu.Unlock()
	return ctxLen
}

type ollamaFunction struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type ollamaTool struct {
	Type     string         `json:"type"`
	Function ollamaFunction `json:"function"`
}

type ollamaChatRequest struct {
	Model     string         `json:"model"`
	Messages  []llm.Message  `json:"messages"`
	Stream    bool           `json:"stream"`
	KeepAlive string         `json:"keep_alive,omitempty"`
	Options   map[string]any `json:"options,omitempty"`
	Tools     []ollamaTool   `json:"tools,omitempty"`
}

type ollamaToolCall struct {
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

type ollamaChatChunk struct {
	Message struct {
		Content   string           `json:"content"`
		ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
	} `json:"message"`
	Done            bool  `json:"done"`
	PromptEvalCount int   `json:"prompt_eval_count"`
	EvalCount       int   `json:"eval_count"`
	EvalDuration    int64 `json:"eval_duration"`
}

func normalizeArguments(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}

	if raw[0] == '"' {
		var str string
		if err := json.Unmarshal(raw, &str); err == nil {
			return json.RawMessage(str)
		}
	}
	return raw
}

func (p *OllamaProvider) Stream(ctx context.Context, messages []llm.Message, tools []llm.Tool) (*llm.Completion, error) {
	modelName := p.model()

	var oTools []ollamaTool
	if len(tools) > 0 {
		oTools = make([]ollamaTool, 0, len(tools))
		for _, t := range tools {
			oTools = append(oTools, ollamaTool{
				Type: "function",
				Function: ollamaFunction{
					Name:        t.Name,
					Description: t.Description,
					Parameters:  t.Parameters,
				},
			})
		}
	}

	body, err := json.Marshal(ollamaChatRequest{
		Model:     modelName,
		Messages:  messages,
		Stream:    true,
		KeepAlive: keepAlive,
		Options:   map[string]any{"num_ctx": GetModelContextLength(ctx, modelName)},
		Tools:     oTools,
	})
	if err != nil {
		return nil, fmt.Errorf("ollama: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, Base+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("ollama: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpx.Streaming().Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama: request: %w", err)
	}

	ch := make(chan llm.StreamEvent)
	done := make(chan struct{})
	var finalUsage *llm.Usage
	go func() {
		defer close(done)
		defer close(ch)
		defer resp.Body.Close()

		var activeCalls []string
		completedCalls := make(map[int]bool)

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			var chunk ollamaChatChunk
			if err := json.Unmarshal(scanner.Bytes(), &chunk); err != nil {
				continue
			}
			if chunk.Message.Content != "" {
				select {
				case ch <- llm.StreamEvent{Kind: llm.EventText, Text: chunk.Message.Content}:
				case <-ctx.Done():
					return
				}
			}

			for i, tc := range chunk.Message.ToolCalls {
				if i >= len(activeCalls) {
					id := fmt.Sprintf("call-%d-%d", time.Now().UnixNano(), i)
					activeCalls = append(activeCalls, id)
					select {
					case ch <- llm.StreamEvent{
						Kind:       llm.EventToolStart,
						ToolCallID: id,
						ToolName:   tc.Function.Name,
					}:
					case <-ctx.Done():
						return
					}
				}
				if !completedCalls[i] && len(tc.Function.Arguments) > 0 {
					id := activeCalls[i]
					normArgs := normalizeArguments(tc.Function.Arguments)
					select {
					case ch <- llm.StreamEvent{
						Kind:       llm.EventToolEnd,
						ToolCallID: id,
						ToolName:   tc.Function.Name,
						Args:       normArgs,
					}:
					case <-ctx.Done():
						return
					}
					completedCalls[i] = true
				}
			}

			if chunk.Done {
				// Token counts arrive on the final (done) chunk.
				var tps float64
				if chunk.EvalDuration > 0 {
					tps = float64(chunk.EvalCount) / (float64(chunk.EvalDuration) / float64(time.Second))
				}
				finalUsage = &llm.Usage{
					Provider:         "ollama",
					Model:            p.model(),
					PromptTokens:     chunk.PromptEvalCount,
					CompletionTokens: chunk.EvalCount,
					TotalTokens:      chunk.PromptEvalCount + chunk.EvalCount,
					TokensPerSecond:  tps,
				}
				return
			}
		}
	}()

	return &llm.Completion{
		Events: ch,
		Wait:   func() *llm.Usage { <-done; return finalUsage },
	}, nil
}

type ollamaTagsResponse struct {
	Models []api.ModelInfo `json:"models"`
}

func ListModels(ctx context.Context) ([]api.ModelInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, Base+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpx.Short(5 * time.Second).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama: tags status %d", resp.StatusCode)
	}
	var tags ollamaTagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&tags); err != nil {
		return nil, err
	}
	if tags.Models == nil {
		tags.Models = []api.ModelInfo{}
	}
	return tags.Models, nil
}

type ollamaGenerateRequest struct {
	Model     string         `json:"model"`
	Prompt    string         `json:"prompt"`
	Stream    bool           `json:"stream"`
	KeepAlive string         `json:"keep_alive,omitempty"`
	Options   map[string]any `json:"options,omitempty"`
}

func PreloadModel(ctx context.Context, model string) error {
	body, err := json.Marshal(ollamaGenerateRequest{
		Model:     model,
		Prompt:    "",
		Stream:    false,
		KeepAlive: keepAlive,
		Options:   map[string]any{"num_ctx": GetModelContextLength(ctx, model)},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, Base+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	// Loading a large model can take a while; allow well beyond the short probe
	// timeout used by ListModels.
	resp, err := httpx.Short(5 * time.Minute).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ollama: preload status %d", resp.StatusCode)
	}
	return nil
}

type ollamaPullRequest struct {
	Name   string `json:"name"`
	Stream bool   `json:"stream"`
}

type ollamaPullChunk struct {
	Status    string `json:"status"`
	Total     int64  `json:"total"`
	Completed int64  `json:"completed"`
	Error     string `json:"error"`
}

func PullModel(ctx context.Context, model string, onProgress func(status string, completed, total int64)) error {
	body, err := json.Marshal(ollamaPullRequest{Name: model, Stream: true})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, Base+"/api/pull", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpx.Streaming().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ollama: pull status %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var chunk ollamaPullChunk
		if err := json.Unmarshal(line, &chunk); err != nil {
			continue
		}
		if chunk.Error != "" {
			return fmt.Errorf("ollama: pull: %s", chunk.Error)
		}
		if onProgress != nil {
			onProgress(chunk.Status, chunk.Completed, chunk.Total)
		}
	}
	return scanner.Err()
}
