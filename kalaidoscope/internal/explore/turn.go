package explore

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// ErrMessagesRequired indicates no messages were provided or generated for the prompt.
var ErrMessagesRequired = errors.New("messages required")

// ErrNoModel indicates no model was configured for chat.
var ErrNoModel = errors.New("no model configured for chat")

// ExploreTooLargeHint follows the guard's message when a full-mode prompt is too
// big: summaries mode is the way through.
const ExploreTooLargeHint = ` Switch the scope to "Summaries" in the context bar to chat over it through summaries instead.`

// PromptTooLargeError captures prompt size overflow with context-aware remediation text.
type PromptTooLargeError struct {
	Err  error
	Text string
}

func (e *PromptTooLargeError) Error() string {
	return e.Text
}

func (e *PromptTooLargeError) Unwrap() error {
	return e.Err
}

// StreamTurn coordinates a full conversational exploration turn, executing either
// standard streaming chat or the summaries multi-round tool agent.
func StreamTurn(ctx context.Context, app core.App, req api.ExploreRequest, w http.ResponseWriter) error {
	var conv *core.Record
	var dbMsgs []api.UIMessage
	if req.ID != "" {
		if c, err := FindOrCreateConversation(ctx, app, req.ID); err == nil {
			conv = c
			dbMsgs, _ = chat.LoadMessages(ctx, app, conv)
		} else {
			logger(app).Error("explore persist: find or create conversation failed", "conversation_id", req.ID, "error", err)
		}
	}

	newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

	// Phase 1: Resolve ContextSpec to PinnedIDs
	chat.ResolveContextSpecs(ctx, app, dbMsgs, newMsgs)

	// Persist new messages
	if conv != nil {
		for _, m := range newMsgs {
			if _, err := chat.PersistMessage(ctx, app, conv, m, ""); err != nil {
				logger(app).Error("explore persist message failed", "message_id", m.ID, "error", err)
			}
		}
	}

	allMsgs := append(dbMsgs, newMsgs...)

	// Phase 2: Prepare LLM Prompt
	hydratedMsgs := PrepareLLMPrompt(ctx, app, conv, allMsgs)
	if len(hydratedMsgs) == 0 {
		return ErrMessagesRequired
	}

	// Re-read every turn, so a mid-conversation model change on the
	// conversation record takes effect on the next message.
	convModel := ""
	if conv != nil {
		convModel = conv.GetString("generate_with_model")
	}
	assistantModel, err := llm.ResolveRoleFor(llm.RoleChat, convModel)
	if err != nil {
		return ErrNoModel
	}

	summaries := ConversationSummaries(allMsgs)

	// Refuse before the call, with a message the user can act on, rather
	// than let the provider reject an oversized prompt as a bare 400.
	if err := llm.CheckPromptFits(assistantModel, llm.MessagesChars(hydratedMsgs)); err != nil {
		logger(app).Warn("explore prompt too large", "conversation_id", req.ID, "error", err)
		text := err.Error()
		if !summaries {
			text += ExploreTooLargeHint
		}
		return &PromptTooLargeError{Err: err, Text: text}
	}

	textID := fmt.Sprintf("txt-%d", time.Now().UnixNano())

	if summaries {
		return StreamSummariesTurn(ctx, app, conv, hydratedMsgs, assistantModel, textID, w)
	}

	comp, err := usage.Stream(ctx, app, llm.RoleChat, assistantModel, hydratedMsgs, nil)
	if err != nil {
		return err
	}

	turn := chat.StreamAssistantResponse(w, comp, textID, nil)

	// Persist the assistant turn once the stream has fully drained.
	if conv != nil {
		var parts []api.UIMessagePart
		if len(turn.Text) > 0 {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: turn.Text})
		}
		for _, tc := range turn.ToolCalls {
			if part, ok := chat.ToolCallPart(tc); ok {
				parts = append(parts, part)
			}
		}
		if len(parts) > 0 {
			aMsg := api.UIMessage{
				ID:    textID,
				Role:  "assistant",
				Parts: parts,
			}
			if _, err := chat.PersistMessage(ctx, app, conv, aMsg, assistantModel); err != nil {
				logger(app).Error("explore persist assistant message failed", "error", err)
			}
		}
	}

	return nil
}
