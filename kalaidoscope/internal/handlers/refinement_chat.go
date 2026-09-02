package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
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

		// A refinement conversation has no model of its own — it always
		// follows the entity it refines.
		parentModel := ""
		if p := refinementParent(app, refRec); p != nil {
			parentModel = p.GetString("model")
		}

		// A send that carries only a new target window (no user text) asks for
		// the standing lens to be re-applied to that window: the preview moves,
		// the lens does not, and the lens-writer is not consulted.
		if win := reapplyWindow(newMsgs); win != nil {
			return streamWindowReapply(e, app, refRec, allMsgs, win, parentModel)
		}

		hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)

		// Prepend system prompt
		hydratedMsgs = append([]llm.Message{{Role: "system", Content: prompts.RefinementSystemPrompt}}, hydratedMsgs...)

		if len(hydratedMsgs) == 0 {
			return e.BadRequestError("messages required", nil)
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
		turnWriter := newTurnWriter(ctx, app, refRec, textID, assistantModel)

		var streamed []api.UIMessagePart
		sse := chat.BeginSSE(e.Response, textID)
		turn := sse.StreamTurn(comp, textID, func(tc llm.ToolCall) {
			part, ok := toolCallPart(tc)
			if !ok {
				return
			}
			streamed = append(streamed, part)
			turnWriter.write(streamed)
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
			turnWriter.write(parts)
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

		if match := engine.LensCountPin(lens); match != "" {
			// Surfaced, not auto-redrafted: the user sees that the lens pinned
			// a count; the apply still runs so they can judge the result.
			log.Printf("refinement chat %s: drafted lens pins a count: %q", refRec.Id, match)
			if data, err := json.Marshal(map[string]string{"match": match}); err == nil {
				sse.DataPart("refine_lint", json.RawMessage(data), false)
				parts = append(parts, api.UIMessagePart{Type: "data-refine_lint", Data: data})
				turnWriter.write(parts)
			}
		}

		pinned, _, win := llmcontext.LatestPinnedAndSpec(allMsgs)
		streamApplyLeg(ctx, app, sse, refRec, turnWriter, parts, lens, pinned, win, parentModel)
		sse.Finish()
		return nil
	}
}

// reapplyWindow is the window a re-apply send names: the new messages hold no
// user turn, and one of them is a system message carrying a `window` part.
func reapplyWindow(newMsgs []api.UIMessage) *api.Window {
	var win *api.Window
	for _, m := range newMsgs {
		if m.Role == "user" {
			return nil
		}
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			if p.Type == "window" && len(p.Data) > 0 {
				var w api.Window
				if json.Unmarshal(p.Data, &w) == nil && w.Start != "" && w.End != "" {
					win = &w
				}
			}
		}
	}
	return win
}

// latestLensPart is the newest update_lens tool part on the transcript and the
// lens it carries; empty when no lens has been drafted yet.
func latestLensPart(msgs []api.UIMessage) (api.UIMessagePart, string) {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		for _, p := range msgs[i].Parts {
			if p.Type != "tool-"+prompts.UpdateLensToolName {
				continue
			}
			var data struct {
				Input struct {
					Lens string `json:"lens"`
				} `json:"input"`
			}
			if err := json.Unmarshal(p.Data, &data); err == nil && strings.TrimSpace(data.Input.Lens) != "" {
				return p, strings.TrimSpace(data.Input.Lens)
			}
		}
	}
	return api.UIMessagePart{}, ""
}

// streamWindowReapply answers a re-apply send: the standing lens is executed
// against the new window and streamed as a fabricated turn that repeats the
// lens part (so the commit-time pairing holds) beside the fresh apply_result,
// marked so llmcontext.Flatten keeps it out of the lens-writer's transcript.
func streamWindowReapply(e *core.RequestEvent, app core.App, refRec *core.Record, allMsgs []api.UIMessage, win *api.Window, parentModel string) error {
	ctx := e.Request.Context()
	textID := fmt.Sprintf("reapply-%d", time.Now().UnixNano())
	sse := chat.BeginSSE(e.Response, textID)

	lensPart, lens := latestLensPart(allMsgs)
	if lens == "" {
		// Nothing drafted yet: the window is recorded on the transcript and
		// the first drafting turn will use it.
		sse.Finish()
		return nil
	}

	marker, _ := json.Marshal(map[string]string{"start": win.Start, "end": win.End})
	sse.DataPart(strings.TrimPrefix(llmcontext.WindowReapplyPartType, "data-"), json.RawMessage(marker), false)
	// Replay the lens tool events so the live message mirrors what persists.
	var lensCall struct {
		ToolCallID string          `json:"toolCallId"`
		Input      json.RawMessage `json:"input"`
	}
	_ = json.Unmarshal(lensPart.Data, &lensCall)
	replayID := fmt.Sprintf("%s-reapply", lensCall.ToolCallID)
	sse.ToolInputStart(replayID, prompts.UpdateLensToolName)
	sse.ToolInputAvailable(replayID, prompts.UpdateLensToolName, lensCall.Input)
	replayed, _ := toolCallPart(llm.ToolCall{ID: replayID, Name: prompts.UpdateLensToolName, Args: lensCall.Input})

	parts := []api.UIMessagePart{
		{Type: llmcontext.WindowReapplyPartType, Data: marker},
		replayed,
	}
	turnWriter := newTurnWriter(ctx, app, refRec, textID, "")
	turnWriter.write(parts)

	pinned, _, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
	streamApplyLeg(ctx, app, sse, refRec, turnWriter, parts, lens, pinned, win, parentModel)
	sse.Finish()
	return nil
}

// turnWriter persists one assistant turn, creating the row on first write and
// rewriting it in place as parts accrue. conv is any conversation record;
// PersistMessage keys the row by the collection it belongs to.
type turnWriter struct {
	ctx   context.Context
	app   core.App
	conv  *core.Record
	id    string
	model string
	rec   *core.Record
}

func newTurnWriter(ctx context.Context, app core.App, conv *core.Record, id, model string) *turnWriter {
	return &turnWriter{ctx: ctx, app: app, conv: conv, id: id, model: model}
}

func (w *turnWriter) write(parts []api.UIMessagePart) {
	msg := api.UIMessage{ID: w.id, Role: "assistant", Parts: parts}
	if w.rec != nil {
		if err := chat.RewriteMessage(w.app, w.rec, msg); err != nil {
			log.Printf("refinement persist: assistant message: %v", err)
		}
		return
	}
	rec, err := chat.PersistMessage(w.ctx, w.app, w.conv, msg, w.model)
	if err != nil {
		log.Printf("refinement persist: assistant message: %v", err)
		return
	}
	w.rec = rec
}

// streamApplyLeg executes lens against the transcript's resolved context for
// win, streaming the output as a fabricated apply_result tool part and
// persisting it beside parts (which must already hold the lens). A failure
// persists a refine_error notice instead, so the turn keeps its lens, the
// preview keeps the last successful output, and a commit of this lens is
// refused until a later apply lands.
func streamApplyLeg(ctx context.Context, app core.App, sse *chat.SSE, refRec *core.Record, w *turnWriter, parts []api.UIMessagePart, lens string, pinned llmcontext.PinnedIDs, win *api.Window, parentModel string) {
	emitTurnError := func(kind, message string) {
		data, err := json.Marshal(map[string]string{"kind": kind, "message": message})
		if err != nil {
			return
		}
		sse.DataPart("refine_error", json.RawMessage(data), false)
		parts = append(parts, api.UIMessagePart{Type: "data-refine_error", Data: data})
		w.write(parts)
	}

	sourceBlock := ""
	if len(pinned.FragmentIDs)+len(pinned.SnapshotIDs) > 0 {
		sourceBlock, _ = llmcontext.HydrateIDsToText(ctx, app, pinned)
	}

	applyModel, err := llm.ResolveRoleFor(llm.RoleSnapshot, parentModel)
	if err != nil {
		emitTurnError("apply_failed", "no model configured for generation")
		return
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
		emitTurnError(kind, message)
		return
	}

	// The available event replaces the streamed partial args with the
	// authoritative (trimmed) output.
	sse.ToolInputDelta(applyID, `"}`)
	sse.ToolInputAvailable(applyID, prompts.ApplyResultToolName, map[string]string{"output": final})

	if args, err := json.Marshal(map[string]string{"output": final}); err == nil {
		if part, ok := toolCallPart(llm.ToolCall{ID: applyID, Name: prompts.ApplyResultToolName, Args: args}); ok {
			parts = append(parts, part)
			w.write(parts)
		}
	}
}
