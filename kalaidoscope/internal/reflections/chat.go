package reflections

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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// ApplyDraftLens executes a drafted standing lens against hydrated sample
// window sources (zero chat history), streaming chunks through onDelta.
func ApplyDraftLens(ctx context.Context, app core.App, model, lensPrompt, sourceBlock string, win *api.Window, onDelta func(string)) (string, error) {
	start, end := engine.WindowBounds(win)
	prompt := prompts.ApplyPrompt(lensPrompt, sourceBlock, start, end)
	if err := llm.CheckPromptFits(model, len(prompt)); err != nil {
		return "", fmt.Errorf("apply lens: %w", err)
	}
	candidate, err := usage.GenerateStreamMsgs(ctx, app,
		[]llm.Message{{Role: "user", Content: prompt}},
		llm.RoleSnapshot, model, onDelta)
	if err != nil {
		return "", fmt.Errorf("apply lens: %w", err)
	}
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", fmt.Errorf("apply lens: model returned empty output")
	}
	return candidate, nil
}

// StreamChatTurn executes one turn of reflection standing-lens authoring.
func StreamChatTurn(ctx context.Context, app core.App, req api.RefinementChatRequest, refRec *core.Record, w http.ResponseWriter) error {
	dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
	newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

	chat.ResolveContextSpecs(ctx, app, dbMsgs, newMsgs)

	for _, m := range newMsgs {
		if _, err := chat.PersistMessage(ctx, app, refRec, m, ""); err != nil {
			logger().Error("reflection chat: persist message failed", "message_id", m.ID, "error", err)
		}
	}

	allMsgs := append(dbMsgs, newMsgs...)

	parent := SessionParent(app, refRec)
	parentModel := ""
	isUnnamed := true
	if parent != nil {
		parentModel = parent.GetString("generate_with_model")
		name := strings.TrimSpace(parent.GetString("name"))
		isUnnamed = name == "" || strings.HasPrefix(name, "Untitled")
	}

	// Window-switch re-apply: re-run the standing lens in isolation against the
	// newly selected sample window without consulting the chat assistant.
	if win := reapplyWindow(newMsgs); win != nil {
		return streamReflectionWindowReapply(ctx, app, refRec, parent, allMsgs, win, parentModel, w)
	}

	if chat.IsContextCancelled(newMsgs) {
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
		_, currentLens = engine.ReadActiveLens(app, Strategy{}, parent)
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
		activeWin = DefaultRefinementWindow(parent, time.Now())
		needsReResolve = true
	}
	if req.ContextSpec != nil {
		spec = StripUpstreamSources(*req.ContextSpec)
		needsReResolve = true
	}
	if needsReResolve {
		if resolved, rerr := llmcontext.ResolveSpecToIDs(ctx, app, StripUpstreamSources(spec), activeWin); rerr == nil {
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
		return chat.ErrMessagesRequired
	}

	assistantModel, err := llm.ResolveRoleFor(llm.RoleRefinement, parentModel)
	if err != nil {
		return chat.ErrNoModel
	}

	if err := llm.CheckPromptFits(assistantModel, llm.MessagesChars(hydratedMsgs)); err != nil {
		logger().Warn("reflection chat prompt too large", "refinement_id", refRec.Id, "error", err)
		return err
	}

	tools := []llm.Tool{SetLensTool, chat.UpdateContextTool}
	if isUnnamed {
		tools = append(tools, chat.SuggestNameTool)
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

	if suggestedName := chat.ExtractSuggestedName(turn.ToolCalls); suggestedName != "" && parent != nil && isUnnamed {
		parent.Set("name", suggestedName)
		_ = app.Save(parent)
	}

	if turn.Text == "" && len(turn.ToolCalls) > 0 && LatestSetLensArg(turn.ToolCalls) == nil && chat.LatestUpdateContextArg(turn.ToolCalls) == nil {
		if text := chat.StreamNameOnlyContinuation(ctx, app, sse, assistantModel, hydratedMsgs, turn, textID); text != "" {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: text})
			turnWriter.Write(parts)
		} else {
			logger().Warn("reflection chat: name-only turn produced no text on continuation", "refinement_id", refRec.Id)
		}
	}

	if ctxArgs := chat.LatestUpdateContextArg(turn.ToolCalls); ctxArgs != nil {
		proposed := chat.ApplyContextOps(spec, *ctxArgs)
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
		_, lens = engine.ReadActiveLens(app, Strategy{}, parent)
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

	if len(pinned.FragmentIDs) == 0 {
		final := EmptyWindowOutput
		sse.ToolInputStart(applyID, prompts.ApplyResultToolName)
		sse.ToolInputDelta(applyID, `{"output":"`+chat.JSONStringChunk(final)+`"}`)
		sse.ToolInputAvailable(applyID, prompts.ApplyResultToolName, map[string]string{"output": final})
		if args, err := json.Marshal(map[string]string{"output": final}); err == nil {
			if part, ok := chat.ToolCallPart(llm.ToolCall{ID: applyID, Name: prompts.ApplyResultToolName, Args: args}); ok {
				parts = append(parts, part)
				w.Write(parts)
			}
		}
		return
	}

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
		sse.ToolInputDelta(applyID, chat.JSONStringChunk(chunk))
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
