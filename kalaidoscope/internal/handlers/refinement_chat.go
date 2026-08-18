package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var updateDraftTool = llm.Tool{
	Name:        prompts.UpdateDraftToolName,
	Description: prompts.UpdateDraftToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"draft": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateDraftParamDescription) + `
			},
			"suggested_name": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateDraftNameDescription) + `
			}
		},
		"required": ["draft"]
	}`),
}

var suggestNameTool = llm.Tool{
	Name:        prompts.SuggestNameToolName,
	Description: prompts.SuggestNameToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"name": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.SuggestNameParamDescription) + `
			}
		},
		"required": ["name"]
	}`),
}

func toolCallPart(tc llm.ToolCall) (api.UIMessagePart, bool) {
	dataBytes, err := json.Marshal(map[string]any{
		"toolCallId": tc.ID,
		"toolName":   tc.Name,
		"input":      tc.Args,
	})
	if err != nil {
		return api.UIMessagePart{}, false
	}
	return api.UIMessagePart{Type: "tool-" + tc.Name, Data: dataBytes}, true
}

func HandleChatForRefinement(app core.App, req api.ChatRequest, refRec *core.Record) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ctx := e.Request.Context()

		dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
		newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

		chat.ResolveContextSpecs(ctx, app, newMsgs)

		for _, m := range newMsgs {
			if _, err := chat.PersistMessage(ctx, app, refRec, m, ""); err != nil {
				log.Printf("refinement persist: message %s: %v", m.ID, err)
			}
		}

		allMsgs := append(dbMsgs, newMsgs...)

		hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)

		// Prepend system prompt
		hydratedMsgs = append([]llm.Message{{Role: "system", Content: prompts.RefinementSystemPrompt}}, hydratedMsgs...)

		if len(hydratedMsgs) == 0 {
			return e.BadRequestError("messages required", nil)
		}

		// A refinement conversation has no model of its own — it always
		// follows the entity it refines.
		parentModel := ""
		if p := refinementParent(app, refRec); p != nil {
			parentModel = p.GetString("model")
		}
		assistantModel, err := llm.ResolveRoleFor(llm.RoleRefinement, parentModel)
		if err != nil {
			return e.InternalServerError("no model configured for refinement", err)
		}

		comp, err := usage.Stream(ctx, app, llm.RoleRefinement, assistantModel, hydratedMsgs, []llm.Tool{updateDraftTool, suggestNameTool})
		if errors.Is(err, usage.ErrExhausted) {
			return usage.WriteExhausted(e, app)
		}
		if usage.WriteProviderError(e, err) {
			return nil
		}
		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		textID := fmt.Sprintf("txt-%d", time.Now().UnixNano())

		var draftRec *core.Record
		var streamed []api.UIMessagePart

		writeTurn := func(parts []api.UIMessagePart) {
			aMsg := api.UIMessage{
				ID:    textID,
				Role:  "assistant",
				Parts: parts,
			}
			if draftRec != nil {
				if err := chat.RewriteMessage(app, draftRec, aMsg); err != nil {
					log.Printf("refinement persist: assistant message: %v", err)
				}
				return
			}
			rec, err := chat.PersistMessage(ctx, app, refRec, aMsg, assistantModel)
			if err != nil {
				log.Printf("refinement persist: assistant message: %v", err)
				return
			}
			draftRec = rec
		}

		turn := chat.StreamAssistantResponse(e.Response, comp, textID, func(tc llm.ToolCall) {
			part, ok := toolCallPart(tc)
			if !ok {
				return
			}
			streamed = append(streamed, part)
			writeTurn(streamed)
		})

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
			writeTurn(parts)
		}

		return nil
	}
}
