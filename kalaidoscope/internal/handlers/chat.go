package handlers

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func HandleChat(app core.App, refinementHandler func(app core.App, req api.ChatRequest, refRec *core.Record) func(e *core.RequestEvent) error) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		req := api.ChatRequest{}
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid chat request body", err)
		}

		ctx := e.Request.Context()

		if refRec, err := app.FindFirstRecordByFilter("refine_proj_snapshot_conversation", "external_conversation_id = {:id}", dbx.Params{"id": req.ID}); err == nil {
			if refinementHandler != nil {
				return refinementHandler(app, req, refRec)(e)
			}
		} else if refRec, err := app.FindFirstRecordByFilter("refine_refl_snapshot_conversation", "external_conversation_id = {:id}", dbx.Params{"id": req.ID}); err == nil {
			if refinementHandler != nil {
				return refinementHandler(app, req, refRec)(e)
			}
		}

		var conv *core.Record
		var dbMsgs []api.UIMessage
		if req.ID != "" {
			if c, err := chat.FindOrCreateConversation(ctx, app, req.ID); err == nil {
				conv = c
				dbMsgs, _ = chat.LoadMessages(ctx, app, conv)
			} else {
				log.Printf("chat persist: FindOrCreateConversation: %v", err)
			}
		}

		newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

		// Phase 1: Resolve ContextSpec to PinnedIDs
		chat.ResolveContextSpecs(ctx, app, newMsgs)

		// Persist new messages
		if conv != nil {
			for _, m := range newMsgs {
				if _, err := chat.PersistMessage(ctx, app, conv, m, ""); err != nil {
					log.Printf("chat persist: message %s: %v", m.ID, err)
				}
			}
		}

		allMsgs := append(dbMsgs, newMsgs...)

		// Phase 2: Prepare LLM Prompt
		hydratedMsgs := chat.PrepareLLMPrompt(ctx, app, conv, allMsgs)
		if len(hydratedMsgs) == 0 {
			return e.BadRequestError("messages required", nil)
		}

		comp, err := usage.Stream(ctx, app, llm.RoleChat, hydratedMsgs, nil)
		if errors.Is(err, usage.ErrExhausted) {
			return usage.WriteExhausted(e, app)
		}
		if usage.WriteProviderError(e, err) {
			return nil
		}
		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		// The same pure lookup usage.Stream just did, recorded on the assistant
		// turn below so provenance survives a later model change.
		assistantModel, _ := llm.ResolveRole(llm.RoleChat)

		textID := fmt.Sprintf("txt-%d", time.Now().UnixNano())

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
					log.Printf("chat persist: assistant message: %v", err)
				}
			}
		}

		return nil
	}
}
