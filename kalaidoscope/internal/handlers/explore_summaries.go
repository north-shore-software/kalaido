// UNREVIEWED
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/agent"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// exploreTooLargeHint follows the guard's message when a full-mode prompt is too
// big: summaries mode is the way through.
const exploreTooLargeHint = ` Switch the scope to "Summaries" in the context bar to chat over it through summaries instead.`

// maxExploreToolRounds caps the model calls in one summaries turn; the last one
// runs without tools so the turn ends in text.
const maxExploreToolRounds = 4

// streamSummariesTurn is the explore turn in summaries mode: the model sees rows,
// not bodies, and may call read_fragment / read_thing; each round's results go
// back as a user turn and the model is called again, all inside one SSE
// response (one assistant message on the client). Reads persist with their
// output so llmcontext.Flatten can replay them on later turns.
func streamSummariesTurn(e *core.RequestEvent, app core.App, conv *core.Record, msgs []llm.Message, model, textID string) error {
	ctx := e.Request.Context()

	reader, err := discover.NewChatReader(app)
	if err != nil {
		return e.InternalServerError("load map for summaries explore", err)
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

	currentComp := comp
	runner := agent.Runner{
		MaxRounds:              maxExploreToolRounds,
		StopBeforeLastDispatch: true,
		Generate: func(ctx context.Context, curMsgs []llm.Message, round int) (agent.Turn, error) {
			if round > 0 {
				next := tools
				if round+1 >= maxExploreToolRounds {
					next = nil
				}
				var err error
				currentComp, err = usage.Stream(ctx, app, llm.RoleChat, model, curMsgs, next)
				if err != nil {
					logger(app).Error("explore summaries stream failed", "text_id", textID, "round", round, "error", err)
					sse.Error(err.Error())
					return agent.Turn{}, err
				}
			}
			turn := sse.StreamTurn(currentComp, fmt.Sprintf("%s-r%d", textID, round), nil)
			if turn.Text != "" {
				parts = append(parts, api.UIMessagePart{Type: "text", Text: turn.Text})
			}
			return agent.Turn{Text: turn.Text, ToolCalls: turn.ToolCalls}, nil
		},
		Dispatch: func(ctx context.Context, tc llm.ToolCall) (string, bool, error) {
			out, ok := reader.Dispatch(ctx, tc)
			if !ok {
				out = prompts.DiscoverUnknownTool(tc.Name)
			}
			return out, false, nil
		},
		OnToolDispatched: func(tc llm.ToolCall, out string) {
			sse.ToolOutputAvailable(tc.ID, out)
			if part, ok := toolResultPart(tc, out); ok {
				parts = append(parts, part)
			}
		},
		PromptGuard: func(updatedMsgs []llm.Message) error {
			if err := engine.CheckPromptFits(model, engine.MessagesChars(updatedMsgs)); err != nil {
				logger(app).Warn("explore summaries prompt too large", "text_id", textID, "error", err)
				sse.Error(err.Error())
				return err
			}
			return nil
		},
		OnRoundEnd: func(ctx context.Context, round int) {
			persist()
		},
	}
	_ = runner.Run(ctx, &msgs)

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
