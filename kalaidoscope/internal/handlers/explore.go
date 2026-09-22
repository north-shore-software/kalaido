// UNREVIEWED
package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/explore"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// HandleExplore handles conversational workspace exploration turns under POST /api/explore.
func HandleExplore(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		req := api.ChatRequest{}
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid explore request body", err)
		}

		ctx := e.Request.Context()

		var conv *core.Record
		var dbMsgs []api.UIMessage
		if req.ID != "" {
			if c, err := explore.FindOrCreateConversation(ctx, app, req.ID); err == nil {
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
		hydratedMsgs := explore.PrepareLLMPrompt(ctx, app, conv, allMsgs)
		if len(hydratedMsgs) == 0 {
			return e.BadRequestError("messages required", nil)
		}

		// Re-read every turn, so a mid-conversation model change on the
		// conversation record takes effect on the next message.
		convModel := ""
		if conv != nil {
			convModel = conv.GetString("generate_with_model")
		}
		assistantModel, err := llm.ResolveRoleFor(llm.RoleChat, convModel)
		if err != nil {
			return e.InternalServerError("no model configured for chat", err)
		}

		summaries := explore.ConversationSummaries(allMsgs)

		// Refuse before the call, with a message the user can act on, rather
		// than let the provider reject an oversized prompt as a bare 400.
		if err := engine.CheckPromptFits(assistantModel, engine.MessagesChars(hydratedMsgs)); err != nil {
			logger(app).Warn("explore prompt too large", "conversation_id", req.ID, "error", err)
			text := err.Error()
			if !summaries {
				text += exploreTooLargeHint
			}
			return e.Error(http.StatusUnprocessableEntity, text, err)
		}

		textID := fmt.Sprintf("txt-%d", time.Now().UnixNano())

		if summaries {
			return streamSummariesTurn(e, app, conv, hydratedMsgs, assistantModel, textID)
		}

		comp, err := usage.Stream(ctx, app, llm.RoleChat, assistantModel, hydratedMsgs, nil)
		if errors.Is(err, usage.ErrExhausted) {
			return usage.WriteExhausted(e, app)
		}
		if usage.WriteProviderError(e, err) {
			return nil
		}
		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		turn := chat.StreamAssistantResponse(e.Response, comp, textID, nil)

		// Persist the assistant turn once the stream has fully drained.
		if conv != nil {
			var parts []api.UIMessagePart
			if len(turn.Text) > 0 {
				parts = append(parts, api.UIMessagePart{Type: "text", Text: turn.Text})
			}
			for _, tc := range turn.ToolCalls {
				if part, ok := toolCallPart(tc); ok {
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
}
