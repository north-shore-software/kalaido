package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const refinementSystemPrompt = `You are a professional assistant helping the user refine a "snapshot" view of their source documents.
Your goal is to distill their requested format, style, and emphasis into a single text output (the "draft").

You have access to the "update_draft" tool. You MUST call "update_draft" to create or update the draft preview whenever you have a meaningfully updated draft.
- Always call "update_draft" with the complete draft text (never a diff).
- Bias heavily toward drafting: make a draft attempt or update on every turn you reasonably can, especially on the very first turn.
- If the user's request is genuinely too ambiguous or underspecified to make any useful draft attempt, you may ask a plain-text clarifying question without calling "update_draft".
- Do not call "update_draft" if the draft content would not change.
- When you call "update_draft", keep your accompanying message to at most one short sentence, and NEVER repeat the draft text in that message — the draft belongs only inside the tool call, which renders in a separate preview pane.
- When you are instead asking a clarifying question (no tool call), a normal, focused question is fine.`

var updateDraftTool = llm.Tool{
	Name:        "update_draft",
	Description: "Updates the live draft preview of the projection snapshot with the full updated content.",
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"draft": {
				"type": "string",
				"description": "The complete, fully-rendered content of the draft. This must be the full text, not a diff."
			}
		},
		"required": ["draft"]
	}`),
}

func HandleChatForRefinement(app core.App, req api.ChatRequest, refRec *core.Record) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ctx := e.Request.Context()

		dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
		newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

		chat.ResolveContextSpecs(ctx, app, newMsgs)

		for _, m := range newMsgs {
			if err := chat.PersistMessage(ctx, app, refRec, m, ""); err != nil {
				log.Printf("refinement persist: message %s: %v", m.ID, err)
			}
		}

		allMsgs := append(dbMsgs, newMsgs...)

		hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)

		// Prepend system prompt
		hydratedMsgs = append([]llm.Message{{Role: "system", Content: refinementSystemPrompt}}, hydratedMsgs...)

		if len(hydratedMsgs) == 0 {
			return e.BadRequestError("messages required", nil)
		}

		comp, err := usage.Stream(ctx, app, llm.RoleRefinement, hydratedMsgs, []llm.Tool{updateDraftTool})
		if errors.Is(err, usage.ErrExhausted) {
			return usage.WriteExhausted(e, app)
		}
		if usage.WriteProviderError(e, err) {
			return nil
		}
		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		assistantModel, _ := llm.ResolveRole(llm.RoleRefinement)

		textID := fmt.Sprintf("txt-%d", time.Now().UnixNano())

		turn := chat.StreamAssistantResponse(e.Response, comp, textID)

		var parts []api.UIMessagePart
		if len(turn.Text) > 0 {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: turn.Text})
		}
		for _, tc := range turn.ToolCalls {
			dataBytes, err := json.Marshal(map[string]any{
				"toolCallId": tc.ID,
				"toolName":   tc.Name,
				"input":      tc.Args,
			})
			if err == nil {
				parts = append(parts, api.UIMessagePart{
					Type: "tool-" + tc.Name,
					Data: dataBytes,
				})
			}
		}
		if len(parts) > 0 {
			aMsg := api.UIMessage{
				ID:    textID,
				Role:  "assistant",
				Parts: parts,
			}
			if err := chat.PersistMessage(ctx, app, refRec, aMsg, assistantModel); err != nil {
				log.Printf("refinement persist: assistant message: %v", err)
			}
		}

		return nil
	}
}
