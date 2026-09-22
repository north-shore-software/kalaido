package chat

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func chatLogger(app core.App) *slog.Logger {
	if app == nil {
		return slog.Default()
	}
	return app.Logger().With("component", "chat")
}

// ToolCallPart translates an LLM tool call into the UIMessage part the AI SDK
// expects to see on the transcript when tool calls stream back.
func ToolCallPart(tc llm.ToolCall) (api.UIMessagePart, bool) {
	dataBytes, err := json.Marshal(map[string]any{
		"toolCallId": tc.ID,
		"toolName":   tc.Name,
		"input":      tc.Args,
		"state":      "call",
	})
	if err != nil {
		return api.UIMessagePart{}, false
	}
	return api.UIMessagePart{Type: "tool-" + tc.Name, Data: dataBytes}, true
}

// ToolResultPart is ToolCallPart with the call's result attached, the shape
// the AI SDK stores once tool-output-available has arrived.
func ToolResultPart(tc llm.ToolCall, output string) (api.UIMessagePart, bool) {
	dataBytes, err := json.Marshal(map[string]any{
		"toolCallId": tc.ID,
		"toolName":   tc.Name,
		"input":      tc.Args,
		"output":     output,
		"state":      "output-available",
	})
	if err != nil {
		return api.UIMessagePart{}, false
	}
	return api.UIMessagePart{Type: "tool-" + tc.Name, Data: dataBytes}, true
}

// TurnWriter persists one assistant turn, creating the row on first write and
// rewriting it in place as parts accrue. conv is any conversation record;
// PersistMessage keys the row by the collection it belongs to.
type TurnWriter struct {
	ctx   context.Context
	app   core.App
	conv  *core.Record
	id    string
	model string
	rec   *core.Record
}

// NewTurnWriter constructs a TurnWriter for a conversation record and assistant message id.
func NewTurnWriter(ctx context.Context, app core.App, conv *core.Record, id, model string) *TurnWriter {
	return &TurnWriter{ctx: ctx, app: app, conv: conv, id: id, model: model}
}

// Write creates or updates the assistant turn message record.
func (w *TurnWriter) Write(parts []api.UIMessagePart) {
	msg := api.UIMessage{ID: w.id, Role: "assistant", Parts: parts}
	if w.rec != nil {
		if err := RewriteMessage(w.app, w.rec, msg); err != nil {
			chatLogger(w.app).Error("persist assistant message rewrite failed", "message_id", w.id, "error", err)
		}
		return
	}
	rec, err := PersistMessage(w.ctx, w.app, w.conv, msg, w.model)
	if err != nil {
		chatLogger(w.app).Error("persist assistant message insert failed", "message_id", w.id, "error", err)
		return
	}
	w.rec = rec
}
