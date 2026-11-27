package refinement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// StreamReflectionTurn executes one turn of reflection standing-lens authoring.
//
// Compared to the legacy shared StreamTurn:
//   - Offers only set_lens { prompt }, update_context (fragments/colours only),
//     and suggest_name (when unnamed). No refine_candidate, no
//     regenerate_from_lens, no CompileLens, and no LensCountPin.
//   - When set_lens is called (or on a window-switch re-apply), runs a strictly
//     isolated ApplyPrompt against the sample window's fragments with zero chat
//     history — or skips the LLM call and returns the hardcoded empty-window
//     text when zero fragments match that window.
//   - On subsequent turns, injects the single latest preview output (and its
//     window bounds) into the system prompt as read-only context so the model
//     can diagnose and tighten the standing lens accurately.
func StreamReflectionTurn(ctx context.Context, app core.App, req api.RefinementChatRequest, refRec *core.Record, w http.ResponseWriter) error {
	dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
	newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

	chat.ResolveContextSpecs(ctx, app, dbMsgs, newMsgs)

	for _, m := range newMsgs {
		if _, err := chat.PersistMessage(ctx, app, refRec, m, ""); err != nil {
			logger().Error("reflection chat: persist message failed", "message_id", m.ID, "error", err)
		}
	}

	allMsgs := append(dbMsgs, newMsgs...)

	parent := Parent(app, refRec)
	parentModel := ""
	isUnnamed := true
	if parent != nil {
		parentModel = parent.GetString("generate_with_model")
		name := strings.TrimSpace(parent.GetString("name"))
		isUnnamed = name == "" || strings.HasPrefix(name, "Untitled")
	}

	// Window-switch re-apply: re-run the standing lens in isolation against the
	// newly selected sample window without consulting the chat assistant.
	if win := ReapplyWindow(newMsgs); win != nil {
		return streamReflectionWindowReapply(ctx, app, refRec, parent, allMsgs, win, parentModel, w)
	}

	// Declining a proposed context change only records the refusal (already
	// persisted above) and closes the stream cleanly.
	if IsContextCancelled(newMsgs) {
		textID := fmt.Sprintf("ctx-cancel-%d", time.Now().UnixNano())
		sse := chat.BeginSSE(w, textID)
		sse.Finish()
		return nil
	}

	currentLens := strings.TrimSpace(req.LensPrompt)
	if currentLens == "" {
		_, currentLens = LatestReflectionLens(allMsgs)
	}
	if currentLens == "" && parent != nil {
		_, currentLens = engine.ReadActiveLens(app, reflections.Strategy{}, parent)
		currentLens = strings.TrimSpace(currentLens)
	}
	hasLens := currentLens != ""

	pinned, spec, activeWin := llmcontext.LatestPinnedAndSpec(allMsgs)
	needsReResolve := false
	if req.Window != nil && req.Window.Start != "" && req.Window.End != "" {
		wCopy := *req.Window
		activeWin = &wCopy
		needsReResolve = true
	} else if activeWin == nil && parent != nil {
		activeWin = reflections.DefaultRefinementWindow(parent, time.Now())
		needsReResolve = true
	}
	if req.ContextSpec != nil {
		spec = reflections.StripUpstreamSources(*req.ContextSpec)
		needsReResolve = true
	}
	if needsReResolve {
		if resolved, rerr := llmcontext.ResolveSpecToIDs(ctx, app, reflections.StripUpstreamSources(spec), activeWin); rerr == nil {
			pinned = resolved
		}
	}

	latestPreview := strings.TrimSpace(req.LatestPreview)
	if latestPreview == "" {
		latestPreview = LatestPreviewOutput(allMsgs)
	}

	hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)
	sysPrompt := prompts.ReflectionChatSystemPrompt(hasLens, isUnnamed, currentLens, latestPreview, activeWin)
	hydratedMsgs = append([]llm.Message{{Role: "system", Content: sysPrompt}}, hydratedMsgs...)

	if len(hydratedMsgs) == 0 {
		return ErrMessagesRequired
	}

	assistantModel, err := llm.ResolveRoleFor(llm.RoleRefinement, parentModel)
	if err != nil {
		return ErrNoModel
	}

	if err := llm.CheckPromptFits(assistantModel, llm.MessagesChars(hydratedMsgs)); err != nil {
		logger().Warn("reflection chat prompt too large", "refinement_id", refRec.Id, "error", err)
		return err
	}

	tools := []llm.Tool{SetLensTool, UpdateContextTool}
	if isUnnamed {
		tools = append(tools, SuggestNameTool)
	}

	comp, err := usage.Stream(ctx, app, llm.RoleRefinement, assistantModel, hydratedMsgs, tools)
	if err != nil {
		return err
	}

	textID := fmt.Sprintf("txt-%d", time.Now().UnixNano())
	turnWriter := chat.NewTurnWriter(ctx, app, refRec, textID, assistantModel)

	var streamed []api.UIMessagePart
	sse := chat.BeginSSE(w, textID)
	turn := sse.StreamTurn(comp, textID, func(tc llm.ToolCall) {
		part, ok := chat.ToolCallPart(tc)
		if !ok {
			return
		}
		streamed = append(streamed, part)
		turnWriter.Write(streamed)
	})
	turnWriter.SetUsage(turn.Usage)

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
		turnWriter.Write(parts)
	}

	if suggestedName := extractSuggestedName(turn.ToolCalls); suggestedName != "" && parent != nil && isUnnamed {
		parent.Set("name", suggestedName)
		_ = app.Save(parent)
	}

	if turn.Text == "" && len(turn.ToolCalls) > 0 && LatestSetLensArg(turn.ToolCalls) == nil && LatestUpdateContextArg(turn.ToolCalls) == nil {
		if text := StreamNameOnlyContinuation(ctx, app, sse, assistantModel, hydratedMsgs, turn, textID); text != "" {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: text})
			turnWriter.Write(parts)
		} else {
			logger().Warn("reflection chat: name-only turn produced no text on continuation", "refinement_id", refRec.Id)
		}
	}

	// Proposed context change ends the turn and awaits user confirmation.
	// Reflections consume fragments and colours only.
	if ctxArgs := LatestUpdateContextArg(turn.ToolCalls); ctxArgs != nil {
		proposed := ApplyContextOps(spec, *ctxArgs)
		proposed.SourceProjectionIDs = nil
		proposed.SourceReflectionIDs = nil
		if confData, err := json.Marshal(prompts.ContextConfirmationData{Spec: proposed, Reason: strings.TrimSpace(ctxArgs.Reason)}); err == nil {
			sse.DataPart(strings.TrimPrefix(prompts.ContextConfirmationPartType, "data-"), json.RawMessage(confData), false)
			parts = append(parts, api.UIMessagePart{Type: prompts.ContextConfirmationPartType, Data: confData})
			turnWriter.Write(parts)
		}
		sse.Finish()
		return nil
	}

	// 1-step standing lens update + strictly isolated sample-window preview.
	if setArgs := LatestSetLensArg(turn.ToolCalls); setArgs != nil {
		if lensData, err := json.Marshal(prompts.LensPartData{Lens: setArgs.Prompt}); err == nil {
			sse.DataPart("lens", json.RawMessage(lensData), false)
			parts = append(parts, api.UIMessagePart{Type: prompts.LensPartType, Data: lensData})
			turnWriter.Write(parts)
		}
		streamReflectionApplyLeg(ctx, app, sse, refRec, turnWriter, parts, setArgs.Prompt, pinned, activeWin, parentModel)
	}

	sse.Finish()
	return nil
}

func streamReflectionWindowReapply(
	ctx context.Context,
	app core.App,
	refRec, parent *core.Record,
	allMsgs []api.UIMessage,
	win *api.Window,
	parentModel string,
	w http.ResponseWriter,
) error {
	textID := fmt.Sprintf("reapply-%d", time.Now().UnixNano())
	sse := chat.BeginSSE(w, textID)

	_, lens := LatestReflectionLens(allMsgs)
	if lens == "" && parent != nil {
		_, lens = engine.ReadActiveLens(app, reflections.Strategy{}, parent)
		lens = strings.TrimSpace(lens)
	}
	if lens == "" {
		sse.Finish()
		return nil
	}

	marker, _ := json.Marshal(map[string]string{"start": win.Start, "end": win.End})
	sse.DataPart(strings.TrimPrefix(llmcontext.WindowReapplyPartType, "data-"), json.RawMessage(marker), false)

	lensData, _ := json.Marshal(prompts.LensPartData{Lens: lens})
	sse.DataPart("lens", json.RawMessage(lensData), false)

	parts := []api.UIMessagePart{
		{Type: llmcontext.WindowReapplyPartType, Data: marker},
		{Type: prompts.LensPartType, Data: lensData},
	}
	turnWriter := chat.NewTurnWriter(ctx, app, refRec, textID, "")
	turnWriter.Write(parts)

	pinned, _, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
	streamReflectionApplyLeg(ctx, app, sse, refRec, turnWriter, parts, lens, pinned, win, parentModel)
	sse.Finish()
	return nil
}

// streamReflectionApplyLeg runs a reflection's standing lens strictly in
// isolation against the sample window's fragments (zero chat history). When
// zero fragments match that sample window, it skips the LLM call and emits the
// hardcoded empty-window preview text.
func streamReflectionApplyLeg(
	ctx context.Context,
	app core.App,
	sse *chat.SSE,
	refRec *core.Record,
	w *chat.TurnWriter,
	parts []api.UIMessagePart,
	lens string,
	pinned llmcontext.PinnedIDs,
	win *api.Window,
	parentModel string,
) {
	emitTurnError := func(kind, message string) {
		data, err := json.Marshal(map[string]string{"kind": kind, "message": message})
		if err != nil {
			return
		}
		sse.DataPart("refine_error", json.RawMessage(data), false)
		parts = append(parts, api.UIMessagePart{Type: "data-refine_error", Data: data})
		w.Write(parts)
	}

	applyID := fmt.Sprintf("apply-%d", time.Now().UnixNano())

	// Empty sample window: skip the LLM call and return hardcoded empty text.
	if len(pinned.FragmentIDs) == 0 {
		final := reflections.EmptyWindowOutput
		sse.ToolInputStart(applyID, prompts.ApplyResultToolName)
		sse.ToolInputDelta(applyID, `{"output":"`+JSONStringChunk(final)+`"}`)
		sse.ToolInputAvailable(applyID, prompts.ApplyResultToolName, map[string]string{"output": final})
		if args, err := json.Marshal(map[string]string{"output": final}); err == nil {
			if part, ok := chat.ToolCallPart(llm.ToolCall{ID: applyID, Name: prompts.ApplyResultToolName, Args: args}); ok {
				parts = append(parts, part)
				w.Write(parts)
			}
		}
		return
	}

	// Reflections hydrate fragments only (never upstream snapshots).
	fragOnly := llmcontext.PinnedIDs{FragmentIDs: pinned.FragmentIDs}
	sourceBlock, _ := llmcontext.HydrateIDsToText(ctx, app, fragOnly)

	applyModel, err := llm.ResolveRoleFor(llm.RoleSnapshot, parentModel)
	if err != nil {
		emitTurnError("apply_failed", "no model configured for generation")
		return
	}

	sse.ToolInputStart(applyID, prompts.ApplyResultToolName)
	sse.ToolInputDelta(applyID, `{"output":"`)

	final, err := ApplyDraftLens(ctx, app, applyModel, lens, sourceBlock, win, func(chunk string) {
		sse.ToolInputDelta(applyID, JSONStringChunk(chunk))
	})
	if err != nil {
		logger().Error("reflection chat apply failed", "refinement_id", refRec.Id, "error", err)
		kind := "apply_failed"
		message := "generating the preview failed — send another message to retry"
		var tooLarge *llm.ContextTooLargeError
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

	sse.ToolInputDelta(applyID, `"}`)
	sse.ToolInputAvailable(applyID, prompts.ApplyResultToolName, map[string]string{"output": final})

	if args, err := json.Marshal(map[string]string{"output": final}); err == nil {
		if part, ok := chat.ToolCallPart(llm.ToolCall{ID: applyID, Name: prompts.ApplyResultToolName, Args: args}); ok {
			parts = append(parts, part)
			w.Write(parts)
		}
	}
}
