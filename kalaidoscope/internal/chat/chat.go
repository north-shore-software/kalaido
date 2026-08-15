package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func ExtractNewMessages(dbMsgs []api.UIMessage, incoming []api.UIMessage) []api.UIMessage {
	existingIDs := make(map[string]bool)
	for _, m := range dbMsgs {
		existingIDs[m.ID] = true
	}

	var newMsgs []api.UIMessage
	for _, m := range incoming {
		if !existingIDs[m.ID] {
			newMsgs = append(newMsgs, m)
		}
	}
	return newMsgs
}

func PrepareLLMPrompt(ctx context.Context, app core.App, conv *core.Record, allMsgs []api.UIMessage) []llm.Message {
	hydratedMsgs := HydrateDeltaHistory(ctx, app, allMsgs)

	return hydratedMsgs
}

type AssistantTurn struct {
	Text      string         `json:"text"`
	ToolCalls []llm.ToolCall `json:"toolCalls"`
}

func StreamAssistantResponse(w http.ResponseWriter, comp *llm.Completion, textID string, onToolCall func(llm.ToolCall)) AssistantTurn {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("x-vercel-ai-ui-message-stream", "v1")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, canFlush := w.(http.Flusher)
	send := func(event any) {
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		if canFlush {
			flusher.Flush()
		}
	}

	sendRate := func(tps float64) {
		send(map[string]any{
			"type":      "data-inference_rate",
			"data":      map[string]any{"tokensPerSecond": tps},
			"transient": true,
		})
	}

	var assistant strings.Builder
	var toolCalls []llm.ToolCall

	send(map[string]string{"type": "start"})

	var textStarted bool
	var genStart, lastEmit time.Time
	var tokenCount int
	for ev := range comp.Events {
		now := time.Now()
		if genStart.IsZero() {
			genStart, lastEmit = now, now
		}

		switch ev.Kind {
		case llm.EventText:
			if !textStarted {
				send(map[string]string{"type": "text-start", "id": textID})
				textStarted = true
			}
			assistant.WriteString(ev.Text)
			tokenCount++
			send(map[string]string{"type": "text-delta", "id": textID, "delta": ev.Text})
			if elapsed := now.Sub(genStart).Seconds(); elapsed > 0 && now.Sub(lastEmit) >= 250*time.Millisecond {
				sendRate(float64(tokenCount) / elapsed)
				lastEmit = now
			}
		case llm.EventToolStart:

			send(map[string]any{
				"type":       "tool-input-start",
				"toolCallId": ev.ToolCallID,
				"toolName":   ev.ToolName,
				"dynamic":    true,
			})
		case llm.EventToolArgDelta:
			send(map[string]any{
				"type":           "tool-input-delta",
				"toolCallId":     ev.ToolCallID,
				"inputTextDelta": ev.Text,
			})
		case llm.EventToolEnd:
			tc := llm.ToolCall{
				ID:   ev.ToolCallID,
				Name: ev.ToolName,
				Args: ev.Args,
			}
			toolCalls = append(toolCalls, tc)
			send(map[string]any{
				"type":       "tool-input-available",
				"toolCallId": ev.ToolCallID,
				"toolName":   ev.ToolName,
				"input":      ev.Args,
				"dynamic":    true,
			})
			if onToolCall != nil {
				onToolCall(tc)
			}
		}
	}
	if textStarted {
		send(map[string]string{"type": "text-end", "id": textID})
	}
	if usage := comp.Wait(); usage != nil && usage.TokensPerSecond > 0 {
		sendRate(usage.TokensPerSecond)
	}
	send(map[string]string{"type": "finish"})
	fmt.Fprintf(w, "data: [DONE]\n\n")
	if canFlush {
		flusher.Flush()
	}

	return AssistantTurn{
		Text:      assistant.String(),
		ToolCalls: toolCalls,
	}
}

func ResolveContextSpecs(ctx context.Context, app core.App, newMsgs []api.UIMessage) {
	for i, m := range newMsgs {
		if m.Role == "system" {
			var resolvedParts []api.UIMessagePart
			for _, p := range m.Parts {
				if p.Type == "context_spec" {
					var spec api.ContextSpec
					if err := json.Unmarshal(p.Data, &spec); err == nil {
						if pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec); err == nil {
							b, _ := json.Marshal(pinned)
							resolvedParts = append(resolvedParts, api.UIMessagePart{
								Type: "pinned_ids",
								Data: b,
							})
						}
					}
				}
			}
			if len(resolvedParts) > 0 {
				newMsgs[i].Parts = append(newMsgs[i].Parts, resolvedParts...)
			}
		}
	}
}

func HydrateDeltaHistory(ctx context.Context, app core.App, allMsgs []api.UIMessage) []llm.Message {
	var activeIDs llmcontext.PinnedIDs
	var hydratedMsgs []llm.Message

	for _, m := range allMsgs {
		if m.Role == "system" {
			var foundPinned bool
			var pinned llmcontext.PinnedIDs
			for _, p := range m.Parts {
				if p.Type == "pinned_ids" && len(p.Data) > 0 {
					if err := json.Unmarshal(p.Data, &pinned); err == nil {
						foundPinned = true
					}
				}
			}
			if foundPinned {
				added, removed := llmcontext.DiffPinnedIDs(activeIDs, pinned)
				deltaText, _ := llmcontext.HydrateContextChange(ctx, app, pinned, added, removed)
				if deltaText != "" {
					hydratedMsgs = append(hydratedMsgs, llm.Message{Role: "system", Content: deltaText})
				}
				activeIDs = pinned
			}
		} else {
			if flat := llmcontext.Flatten([]api.UIMessage{m}); len(flat) > 0 {
				hydratedMsgs = append(hydratedMsgs, flat...)
			}
		}
	}
	return hydratedMsgs
}
