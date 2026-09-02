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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
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

// ConversationSummaries reports whether the transcript's current context spec
// asks for summaries mode. It is the one source of truth for the handler, the
// hydration and the prompt choice.
func ConversationSummaries(allMsgs []api.UIMessage) bool {
	_, spec, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
	return spec.Summaries
}

func PrepareLLMPrompt(ctx context.Context, app core.App, conv *core.Record, allMsgs []api.UIMessage) []llm.Message {
	hydratedMsgs := HydrateDeltaHistory(ctx, app, allMsgs)
	if len(hydratedMsgs) == 0 {
		return nil
	}
	system := prompts.ChatSystemPrompt
	if ConversationSummaries(allMsgs) {
		digest := ""
		if doc, _, err := mapping.LoadDocument(app); err == nil {
			digest = prompts.SummariesMapDigest(doc, prompts.SummariesThingFloor)
		}
		system = prompts.ChatSummariesSystemPrompt(digest)
	}
	return append([]llm.Message{{Role: "system", Content: system}}, hydratedMsgs...)
}

type AssistantTurn struct {
	Text      string         `json:"text"`
	ToolCalls []llm.ToolCall `json:"toolCalls"`
}

// SSE is an open AI-SDK v1 UI-message stream. It exists so a handler can keep
// the response open past the model turn — streaming further server-driven
// units (fabricated tool calls, data parts) before Finish closes the protocol.
type SSE struct {
	w       http.ResponseWriter
	flusher http.Flusher // nil when the writer can't flush
}

// BeginSSE writes the stream headers and the mandatory "start" event.
//
// The message id has to travel to the client, or the AI SDK mints its own for
// the assistant message, posts that back on the next turn, and
// ExtractNewMessages — which dedupes on id alone — persists the turn a second
// time.
func BeginSSE(w http.ResponseWriter, messageID string) *SSE {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("x-vercel-ai-ui-message-stream", "v1")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	s := &SSE{w: w}
	s.flusher, _ = w.(http.Flusher)
	s.Send(map[string]string{"type": "start", "messageId": messageID})
	return s
}

func (s *SSE) Send(event any) {
	data, _ := json.Marshal(event)
	fmt.Fprintf(s.w, "data: %s\n\n", data)
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

func (s *SSE) sendRate(tps float64) {
	s.DataPart("inference_rate", map[string]any{"tokensPerSecond": tps}, true)
}

// DataPart emits a "data-<name>" part. Transient parts are delivered to the
// client's onData handler only; non-transient ones become message parts.
func (s *SSE) DataPart(name string, data any, transient bool) {
	ev := map[string]any{
		"type": "data-" + name,
		"data": data,
	}
	if transient {
		ev["transient"] = true
	}
	s.Send(ev)
}

// ToolInputStart/ToolInputDelta/ToolInputAvailable emit the same events a real
// model tool call produces, letting the server fabricate a streamed tool part
// the stock AI SDK transport accumulates like any other. "dynamic" makes the
// SDK materialize it as a dynamic-tool part rather than requiring a typed tool.
func (s *SSE) ToolInputStart(toolCallID, toolName string) {
	s.Send(map[string]any{
		"type":       "tool-input-start",
		"toolCallId": toolCallID,
		"toolName":   toolName,
		"dynamic":    true,
	})
}

func (s *SSE) ToolInputDelta(toolCallID, chunk string) {
	s.Send(map[string]any{
		"type":           "tool-input-delta",
		"toolCallId":     toolCallID,
		"inputTextDelta": chunk,
	})
}

func (s *SSE) ToolInputAvailable(toolCallID, toolName string, input any) {
	s.Send(map[string]any{
		"type":       "tool-input-available",
		"toolCallId": toolCallID,
		"toolName":   toolName,
		"input":      input,
		"dynamic":    true,
	})
}

// ToolOutputAvailable delivers a tool call's result; the stock transport
// stores it as the dynamic part's output.
func (s *SSE) ToolOutputAvailable(toolCallID string, output any) {
	s.Send(map[string]any{
		"type":       "tool-output-available",
		"toolCallId": toolCallID,
		"output":     output,
	})
}

// Error surfaces a failure after the headers are gone: the client's onError
// fires with the text.
func (s *SSE) Error(text string) {
	s.Send(map[string]string{"type": "error", "errorText": text})
}

// StreamTurn drains one model completion into the stream and returns the
// assembled turn. It does not close the stream; call Finish for that.
func (s *SSE) StreamTurn(comp *llm.Completion, textID string, onToolCall func(llm.ToolCall)) AssistantTurn {
	var assistant strings.Builder
	var toolCalls []llm.ToolCall

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
				s.Send(map[string]string{"type": "text-start", "id": textID})
				textStarted = true
			}
			assistant.WriteString(ev.Text)
			tokenCount++
			s.Send(map[string]string{"type": "text-delta", "id": textID, "delta": ev.Text})
			if elapsed := now.Sub(genStart).Seconds(); elapsed > 0 && now.Sub(lastEmit) >= 250*time.Millisecond {
				s.sendRate(float64(tokenCount) / elapsed)
				lastEmit = now
			}
		case llm.EventToolStart:
			s.ToolInputStart(ev.ToolCallID, ev.ToolName)
		case llm.EventToolArgDelta:
			s.ToolInputDelta(ev.ToolCallID, ev.Text)
		case llm.EventToolEnd:
			tc := llm.ToolCall{
				ID:   ev.ToolCallID,
				Name: ev.ToolName,
				Args: ev.Args,
			}
			toolCalls = append(toolCalls, tc)
			s.ToolInputAvailable(ev.ToolCallID, ev.ToolName, ev.Args)
			if onToolCall != nil {
				onToolCall(tc)
			}
		}
	}
	if textStarted {
		s.Send(map[string]string{"type": "text-end", "id": textID})
	}
	if usage := comp.Wait(); usage != nil && usage.TokensPerSecond > 0 {
		s.sendRate(usage.TokensPerSecond)
	}

	return AssistantTurn{
		Text:      assistant.String(),
		ToolCalls: toolCalls,
	}
}

func (s *SSE) Finish() {
	s.Send(map[string]string{"type": "finish"})
	fmt.Fprintf(s.w, "data: [DONE]\n\n")
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

func StreamAssistantResponse(w http.ResponseWriter, comp *llm.Completion, textID string, onToolCall func(llm.ToolCall)) AssistantTurn {
	sse := BeginSSE(w, textID)
	turn := sse.StreamTurn(comp, textID, onToolCall)
	sse.Finish()
	return turn
}

// ResolveContextSpecs stamps each incoming system message that changes the
// context — a `context_spec` part, a `window` part, or both — with the
// `pinned_ids` that (spec, window) pair resolves to right now. The pair is
// cumulative across the transcript: a window change alone re-resolves the
// spec already in effect (read from history), and vice versa, so pinned_ids
// always reflect both.
func ResolveContextSpecs(ctx context.Context, app core.App, history, newMsgs []api.UIMessage) {
	_, spec, win := llmcontext.LatestPinnedAndSpec(history)
	for i, m := range newMsgs {
		if m.Role != "system" {
			continue
		}
		changed := false
		for _, p := range m.Parts {
			switch p.Type {
			case "context_spec":
				var s api.ContextSpec
				if err := json.Unmarshal(p.Data, &s); err == nil {
					spec = s
					changed = true
				}
			case "window":
				var w api.Window
				if err := json.Unmarshal(p.Data, &w); err == nil {
					if w.Start != "" && w.End != "" {
						win = &w
					} else {
						win = nil
					}
					changed = true
				}
			}
		}
		if !changed {
			continue
		}
		if pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, win); err == nil {
			b, _ := json.Marshal(pinned)
			newMsgs[i].Parts = append(newMsgs[i].Parts, api.UIMessagePart{
				Type: "pinned_ids",
				Data: b,
			})
		}
	}
}

// messageWindow is the `window` part a system message carries, if any.
func messageWindow(m api.UIMessage) *api.Window {
	for _, p := range m.Parts {
		if p.Type == "window" && len(p.Data) > 0 {
			var w api.Window
			if json.Unmarshal(p.Data, &w) == nil && w.Start != "" && w.End != "" {
				return &w
			}
		}
	}
	return nil
}

// HydrateDeltaHistory renders the transcript for the model. The mode is the
// conversation's current one, applied to every delta: a transcript that turned
// summaries on after a failed full-mode turn re-renders its whole context as
// rows, which is what lets that turn recover.
func HydrateDeltaHistory(ctx context.Context, app core.App, allMsgs []api.UIMessage) []llm.Message {
	var activeIDs llmcontext.PinnedIDs
	var hydratedMsgs []llm.Message
	summaries := ConversationSummaries(allMsgs)

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
			var text string
			if w := messageWindow(m); w != nil {
				text = prompts.WindowNotice(w.Start, w.End)
			}
			if foundPinned {
				added, removed := llmcontext.DiffPinnedIDs(activeIDs, pinned)
				deltaText, _ := llmcontext.HydrateDeltaToText(ctx, app, added, removed, summaries)
				text += deltaText
				activeIDs = pinned
			}
			if text != "" {
				hydratedMsgs = append(hydratedMsgs, llm.Message{Role: "system", Content: text})
			}
		} else {
			if flat := llmcontext.Flatten([]api.UIMessage{m}); len(flat) > 0 {
				hydratedMsgs = append(hydratedMsgs, flat...)
			}
		}
	}
	return hydratedMsgs
}
