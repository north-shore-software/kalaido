package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

var updateLensTool = llm.Tool{
	Name:        prompts.UpdateLensToolName,
	Description: prompts.UpdateLensToolDescription,
	Parameters: json.RawMessage(`{
		"type": "object",
		"properties": {
			"lens": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateLensParamDescription) + `
			},
			"suggested_name": {
				"type": "string",
				"description": ` + strconv.Quote(prompts.UpdateLensNameDescription) + `
			}
		},
		"required": ["lens"]
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

// latestLensArg returns the lens from the turn's last update_lens call, or ""
// when the turn drafted none (a clarify question, or an unchanged lens).
func latestLensArg(toolCalls []llm.ToolCall) string {
	for i := len(toolCalls) - 1; i >= 0; i-- {
		if toolCalls[i].Name != prompts.UpdateLensToolName {
			continue
		}
		var args struct {
			Lens string `json:"lens"`
		}
		if err := json.Unmarshal(toolCalls[i].Args, &args); err == nil && args.Lens != "" {
			return args.Lens
		}
	}
	return ""
}

// jsonStringChunk escapes one streamed text chunk for insertion into an
// in-progress JSON string literal (the fabricated apply_result args stream).
func jsonStringChunk(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}

func HandleChatForRefinement(app core.App, req api.ChatRequest, refRec *core.Record) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		ctx := e.Request.Context()

		dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
		newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

		chat.ResolveContextSpecs(ctx, app, dbMsgs, newMsgs)

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

		// Refuse before the call, with a message the user can act on, rather
		// than let the provider reject an oversized prompt as a bare 400.
		if err := engine.CheckPromptFits(assistantModel, engine.MessagesChars(hydratedMsgs)); err != nil {
			log.Printf("refinement chat %s: %v", refRec.Id, err)
			return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
		}

		comp, err := usage.Stream(ctx, app, llm.RoleRefinement, assistantModel, hydratedMsgs, []llm.Tool{updateLensTool, suggestNameTool})
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

		sse := chat.BeginSSE(e.Response, textID)
		turn := sse.StreamTurn(comp, textID, func(tc llm.ToolCall) {
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

		// Phase two: execute the drafted lens so the user previews what it
		// actually produces — the same RoleSnapshot call a future regeneration
		// under this lens makes, always from scratch (a drafted lens is a
		// changed lens; see engine.ApplyDraftLens). The lens-writing model
		// never sees this output; it streams to the client as a fabricated
		// apply_result tool part and persists beside the lens on the same
		// assistant message.
		lens := latestLensArg(turn.ToolCalls)
		if lens == "" {
			// A clarify turn, or an unchanged lens: nothing to apply, the
			// preview keeps its prior output.
			sse.Finish()
			return nil
		}

		emitTurnError := func(kind, message string) {
			data, err := json.Marshal(map[string]string{"kind": kind, "message": message})
			if err != nil {
				return
			}
			sse.DataPart("refine_error", json.RawMessage(data), false)
			parts = append(parts, api.UIMessagePart{Type: "data-refine_error", Data: data})
			writeTurn(parts)
		}

		if match := engine.LensCountPin(lens); match != "" {
			// Surfaced, not auto-redrafted: the user sees that the lens pinned
			// a count; the apply still runs so they can judge the result.
			log.Printf("refinement chat %s: drafted lens pins a count: %q", refRec.Id, match)
			if data, err := json.Marshal(map[string]string{"match": match}); err == nil {
				sse.DataPart("refine_lint", json.RawMessage(data), false)
				parts = append(parts, api.UIMessagePart{Type: "data-refine_lint", Data: data})
				writeTurn(parts)
			}
		}

		pinned, _, win := llmcontext.LatestPinnedAndSpec(allMsgs)
		sourceBlock := ""
		if len(pinned.FragmentIDs)+len(pinned.SnapshotIDs) > 0 {
			sourceBlock, _ = llmcontext.HydrateIDsToText(ctx, app, pinned)
		}

		applyModel, err := llm.ResolveRoleFor(llm.RoleSnapshot, parentModel)
		if err != nil {
			emitTurnError("apply_failed", "no model configured for generation")
			sse.Finish()
			return nil
		}

		applyID := fmt.Sprintf("apply-%d", time.Now().UnixNano())
		// The start event goes out before the model call: its arrival is what
		// moves the client's preview into the "applying" phase, covering the
		// dead period before the first token.
		sse.ToolInputStart(applyID, prompts.ApplyResultToolName)
		sse.ToolInputDelta(applyID, `{"output":"`)

		final, err := engine.ApplyDraftLens(ctx, app, applyModel, lens, sourceBlock, win, func(chunk string) {
			sse.ToolInputDelta(applyID, jsonStringChunk(chunk))
		})
		if err != nil {
			log.Printf("refinement chat %s: apply failed: %v", refRec.Id, err)
			kind := "apply_failed"
			message := "generating the preview failed — send another message to retry"
			var tooLarge *engine.ContextTooLargeError
			switch {
			case errors.Is(err, usage.ErrExhausted):
				kind = "quota_exhausted"
			case errors.As(err, &tooLarge):
				kind = "context_too_large"
				message = tooLarge.Error()
			}
			// No tool-input-available and no persisted apply part: the turn
			// keeps its lens, the preview keeps the last successful output,
			// and a commit of this lens is refused until a later apply lands.
			emitTurnError(kind, message)
			sse.Finish()
			return nil
		}

		// The available event replaces the streamed partial args with the
		// authoritative (trimmed) output.
		sse.ToolInputDelta(applyID, `"}`)
		sse.ToolInputAvailable(applyID, prompts.ApplyResultToolName, map[string]string{"output": final})

		if args, err := json.Marshal(map[string]string{"output": final}); err == nil {
			if part, ok := toolCallPart(llm.ToolCall{ID: applyID, Name: prompts.ApplyResultToolName, Args: args}); ok {
				parts = append(parts, part)
				writeTurn(parts)
			}
		}

		sse.Finish()
		return nil
	}
}
