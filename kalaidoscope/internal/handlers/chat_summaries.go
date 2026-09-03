package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// chatTooLargeHint follows the guard's message when a full-mode prompt is too
// big: summaries mode is the way through.
const chatTooLargeHint = ` Switch the scope to "Summaries" in the context bar to chat over it through summaries instead.`

// maxChatToolRounds caps the model calls in one summaries turn; the last one
// runs without tools so the turn ends in text.
const maxChatToolRounds = 4

// streamSummariesTurn is the chat turn in summaries mode: the model sees rows,
// not bodies, and may call read_fragment / read_thing; each round's results go
// back as a user turn and the model is called again, all inside one SSE
// response (one assistant message on the client). Reads persist with their
// output so llmcontext.Flatten can replay them on later turns.
func streamSummariesTurn(e *core.RequestEvent, app core.App, conv *core.Record, msgs []llm.Message, model, textID string) error {
	ctx := e.Request.Context()

	reader, err := discover.NewChatReader(app)
	if err != nil {
		return e.InternalServerError("load map for summaries chat", err)
	}
	tools := discover.ChatReadTools()

	comp, err := usage.Stream(ctx, app, llm.RoleChat, model, msgs, tools)
	if errors.Is(err, usage.ErrExhausted) {
		return usage.WriteExhausted(e, app)
	}
	if usage.WriteProviderError(e, err) {
		return nil
	}
	if err != nil {
		return e.InternalServerError("llm stream failed", err)
	}

	sse := chat.BeginSSE(e.Response, textID)
	var w *turnWriter
	if conv != nil {
		w = newTurnWriter(ctx, app, conv, textID, model)
	}
	var parts []api.UIMessagePart
	persist := func() {
		if w != nil && len(parts) > 0 {
			w.write(parts)
		}
	}

	for round := 0; ; round++ {
		turn := sse.StreamTurn(comp, fmt.Sprintf("%s-r%d", textID, round), nil)
		if turn.Text != "" {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: turn.Text})
		}
		if len(turn.ToolCalls) == 0 || round+1 >= maxChatToolRounds {
			break
		}

		names := make([]string, 0, len(turn.ToolCalls))
		results := make([]string, 0, len(turn.ToolCalls))
		for _, tc := range turn.ToolCalls {
			out, ok := reader.Dispatch(ctx, tc)
			if !ok {
				out = prompts.DiscoverUnknownTool(tc.Name)
			}
			sse.ToolOutputAvailable(tc.ID, out)
			if part, ok := toolResultPart(tc, out); ok {
				parts = append(parts, part)
			}
			names = append(names, tc.Name)
			results = append(results, out)
		}
		// Written per round so an interrupted turn still leaves its reads.
		persist()

		msgs = append(msgs,
			llm.Message{Role: "assistant", Content: turn.Text + prompts.DiscoverEchoToolCalls(names)},
			llm.Message{Role: "user", Content: strings.Join(results, "\n\n")})

		if err := engine.CheckPromptFits(model, engine.MessagesChars(msgs)); err != nil {
			log.Printf("chat %s: round %d: %v", textID, round+1, err)
			sse.Error(err.Error())
			break
		}
		next := tools
		if round+2 >= maxChatToolRounds {
			next = nil
		}
		comp, err = usage.Stream(ctx, app, llm.RoleChat, model, msgs, next)
		if err != nil {
			log.Printf("chat %s: round %d: %v", textID, round+1, err)
			sse.Error(err.Error())
			break
		}
	}

	persist()
	sse.Finish()
	return nil
}

// toolResultPart is toolCallPart with the call's result attached, the shape
// the AI SDK stores once tool-output-available has arrived.
func toolResultPart(tc llm.ToolCall, output string) (api.UIMessagePart, bool) {
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
