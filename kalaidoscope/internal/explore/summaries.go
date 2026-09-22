// UNREVIEWED
package explore

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

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

func logger(app core.App) *slog.Logger {
	if app == nil {
		return slog.Default()
	}
	return app.Logger().With("component", "explore")
}

// maxExploreToolRounds caps the model calls in one summaries turn; the last one
// runs without tools so the turn ends in text.
const maxExploreToolRounds = 4

// StreamSummariesTurn is the explore turn in summaries mode: the model sees rows,
// not bodies, and may call read_fragment / read_thing; each round's results go
// back as a user turn and the model is called again, all inside one SSE
// response (one assistant message on the client). Reads persist with their
// output so llmcontext.Flatten can replay them on later turns.
func StreamSummariesTurn(ctx context.Context, app core.App, conv *core.Record, msgs []llm.Message, model, textID string, w http.ResponseWriter) error {
	reader, err := discover.NewChatReader(app)
	if err != nil {
		return fmt.Errorf("load map for summaries explore: %w", err)
	}
	tools := discover.ChatReadTools()

	comp, err := usage.Stream(ctx, app, llm.RoleChat, model, msgs, tools)
	if err != nil {
		return err
	}

	sse := chat.BeginSSE(w, textID)
	var tw *chat.TurnWriter
	if conv != nil {
		tw = chat.NewTurnWriter(ctx, app, conv, textID, model)
	}
	var parts []api.UIMessagePart
	persist := func() {
		if tw != nil && len(parts) > 0 {
			tw.Write(parts)
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
			if part, ok := chat.ToolResultPart(tc, out); ok {
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
