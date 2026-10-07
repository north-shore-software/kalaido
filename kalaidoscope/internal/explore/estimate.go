package explore

import (
	"context"
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// PromptEstimate is the size of the prompt a conversation's next turn would
// send, split the way the transcript is built: the system prompt, the context
// deltas (hydrated fragment bodies or summary rows), and the explore turns
// themselves. Tokens are the guard's chars/4 estimate.
type PromptEstimate struct {
	System     int
	Context    int
	Transcript int
	// Model the conversation would be answered by: its own override when
	// set, else the chat role's default.
	Model string
	// Measured is the provider's own count for the last answered turn (its
	// prompt plus what it generated), when the transcript carries one; the
	// estimate is then only applied to what changed after that turn.
	Measured int
	// Since is the chars/4 estimate of how the prompt changed after the
	// measured turn: later messages and the pending context delta. Negative
	// when context was dropped, since the transcript re-renders against the
	// current context and an unpinned fragment's body no longer replays.
	Since int
}

// Total is the size of the next turn: the measured anchor plus the estimate
// of what changed after it, or the whole estimate when nothing was measured.
func (p PromptEstimate) Total() int {
	if p.Measured > 0 {
		return max(p.Measured+p.Since, 0)
	}
	return p.System + p.Context + p.Transcript
}

// EstimatePrompt sizes the next turn of the explore conversation identified by the
// client id, as if `spec` (and `win`, when given) were the context in effect
// for that turn. It reads the persisted transcript without creating the
// conversation: a chat that has not sent yet estimates as an empty history
// plus the pending context, which is exactly what its first send would carry.
//
// The pending spec is applied the way ChatPanel applies it — as a trailing
// system message resolved to pinned ids — so a spec identical to the one
// already in effect adds nothing, and a changed one costs its delta.
func EstimatePrompt(ctx context.Context, app core.App, clientID string, spec *api.ContextSpec, win *api.Window) (PromptEstimate, error) {
	var est PromptEstimate
	var conv *core.Record
	var dbMsgs []api.UIMessage
	if rec, err := app.FindFirstRecordByFilter(
		"chat_conversation",
		"external_conversation_id = {:cid}",
		dbx.Params{"cid": clientID},
	); err == nil {
		conv = rec
		msgs, err := chat.LoadMessages(ctx, app, conv)
		if err != nil {
			return est, err
		}
		dbMsgs = msgs
	}

	var pending []api.UIMessage
	if spec != nil {
		var parts []api.UIMessagePart
		if b, err := json.Marshal(spec); err == nil {
			parts = append(parts, api.UIMessagePart{Type: "context_spec", Data: b})
		}
		if win != nil {
			if b, err := json.Marshal(win); err == nil {
				parts = append(parts, api.UIMessagePart{Type: "window", Data: b})
			}
		}
		pending = []api.UIMessage{{ID: "estimate-spec", Role: "system", Parts: parts}}
		chat.ResolveContextSpecs(ctx, app, dbMsgs, pending)
	}

	allMsgs := append(append([]api.UIMessage(nil), dbMsgs...), pending...)
	msgs := PrepareLLMPrompt(ctx, app, conv, allMsgs)
	for i, m := range msgs {
		tokens := llm.EstimateTokens(len(m.Content))
		switch {
		case i == 0:
			est.System += tokens
		case m.Role == "system":
			est.Context += tokens
		default:
			est.Transcript += tokens
		}
	}
	if at, u := lastMeasured(dbMsgs); u != nil {
		est.Measured = u.PromptTokens + u.CompletionTokens
		upTo := llm.EstimateTokens(llm.MessagesChars(PrepareLLMPrompt(ctx, app, conv, dbMsgs[:at+1])))
		est.Since = llm.EstimateTokens(llm.MessagesChars(msgs)) - upTo
	}
	if conv != nil {
		est.Model = conv.GetString("generate_with_model")
	}
	return est, nil
}

// lastMeasured finds the latest assistant message that carries the provider's
// usage, with its index; -1 and nil when none does.
func lastMeasured(msgs []api.UIMessage) (int, *api.TurnUsage) {
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role == "assistant" && m.Metadata != nil && m.Metadata.Usage != nil && m.Metadata.Usage.PromptTokens > 0 {
			return i, m.Metadata.Usage
		}
	}
	return -1, nil
}
