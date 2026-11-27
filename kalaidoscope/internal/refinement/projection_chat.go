package refinement

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// StreamProjectionTurn executes one canvas-aware turn for a projection
// refinement session. Unlike the legacy/reflection lens-writing path, the
// projection assistant sees the live draft directly, edits it via write_draft /
// propose_edit / update_draft / request_full_rewrite, never calls CompileLens
// or LensCountPin mid-session, and never creates preview lens rows.
func StreamProjectionTurn(ctx context.Context, app core.App, req api.RefinementChatRequest, refRec *core.Record, w http.ResponseWriter) error {
	dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
	newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

	chat.ResolveContextSpecs(ctx, app, dbMsgs, newMsgs)

	for _, m := range newMsgs {
		if _, err := chat.PersistMessage(ctx, app, refRec, m, ""); err != nil {
			logger().Error("projection chat: persist message failed", "message_id", m.ID, "error", err)
		}
	}

	allMsgs := append(dbMsgs, newMsgs...)
	pinned, spec, _ := llmcontext.LatestPinnedAndSpec(allMsgs)

	parent := Parent(app, refRec)
	parentModel := ""
	projID := refRec.GetString("projection_id")
	var standingBrief string
	isUnnamed := true
	if parent != nil {
		parentModel = parent.GetString("generate_with_model")
		_, standingBrief = engine.ReadActiveLens(app, projections.Strategy{}, parent)
		name := strings.TrimSpace(parent.GetString("name"))
		isUnnamed = name == "" || strings.HasPrefix(name, "Untitled")
	}

	// Keep the bound pending candidate's context_spec/resolved_context in sync
	// whenever context changed via picker or AI confirmation.
	pickerContextChanged := IsPickerContextChange(newMsgs)
	if pickerContextChanged || IsContextConfirmed(newMsgs) {
		syncPendingCandidateContext(app, refRec, spec, pinned)
	}

	// Declining a proposed context change or full-body rewrite only records the
	// refusal (already persisted above) and closes the stream cleanly.
	if IsContextCancelled(newMsgs) || IsFullRewriteCancelled(newMsgs) {
		textID := fmt.Sprintf("cancel-%d", time.Now().UnixNano())
		sse := chat.BeginSSE(w, textID)
		sse.Finish()
		return nil
	}

	// Confirming a full-body rewrite that already carries proposedContent
	// (from update_draft or cross-session Update exceeding threshold) applies
	// that body directly without an extra LLM call.
	fullRewriteConfirmed := IsFullRewriteConfirmed(newMsgs)
	if fullRewriteConfirmed {
		if conf, ok := LatestFullRewriteConfirmation(allMsgs); ok && strings.TrimSpace(conf.ProposedContent) != "" {
			return applyConfirmedFullRewrite(ctx, app, refRec, w, strings.TrimSpace(conf.ProposedContent), pinned, spec, parentModel)
		}
	}

	// Load current live draft from the bound pending candidate (if any).
	var liveDraft string
	var snapRec *core.Record
	if snapID := refRec.GetString("projection_snapshot_id"); snapID != "" {
		if rec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID); err == nil && rec.GetString("status") == engine.StatusPending {
			snapRec = rec
			liveDraft = formatLiveDraftForModel(rec.GetString("output_draft"), engine.LoadSnapshotEdits(rec))
		}
	}
	hasDraft := strings.TrimSpace(liveDraft) != ""

	hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)
	sysPrompt := prompts.ProjectionChatSystemPrompt(hasDraft, isUnnamed, fullRewriteConfirmed, standingBrief, liveDraft)
	hydratedMsgs = append([]llm.Message{{Role: "system", Content: sysPrompt}}, hydratedMsgs...)

	if pickerContextChanged {
		hydratedMsgs = append(hydratedMsgs, llm.Message{
			Role:    "system",
			Content: prompts.PickerContextChangeHint,
		})
	}

	if len(hydratedMsgs) == 0 {
		return ErrMessagesRequired
	}

	assistantModel, err := llm.ResolveRoleFor(llm.RoleRefinement, parentModel)
	if err != nil {
		return ErrNoModel
	}

	if err := llm.CheckPromptFits(assistantModel, llm.MessagesChars(hydratedMsgs)); err != nil {
		logger().Warn("projection chat prompt too large", "refinement_id", refRec.Id, "error", err)
		return err
	}

	// Choose the projection tool set. Picker acknowledgement turns advertise no
	// draft-mutating tools so the assistant replies conversationally without
	// blindly overwriting the draft.
	var tools []llm.Tool
	if !pickerContextChanged {
		if !hasDraft || fullRewriteConfirmed {
			tools = append(tools, WriteDraftTool, UpdateContextTool)
		} else {
			tools = append(tools, ProposeEditTool, UpdateDraftTool, RequestFullRewriteTool, UpdateContextTool)
		}
		if isUnnamed {
			tools = append(tools, SuggestNameTool)
		}
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

	suggestedName := extractSuggestedName(turn.ToolCalls)
	if suggestedName != "" && parent != nil && isUnnamed {
		parent.Set("name", suggestedName)
		_ = app.Save(parent)
	}

	// If the model emitted only suggest_name with no text and no other tool,
	// run one continuation turn so the user sees a reply.
	if turn.Text == "" && len(turn.ToolCalls) > 0 &&
		LatestWriteDraftArg(turn.ToolCalls) == nil &&
		!HasProposeEditCall(turn.ToolCalls) &&
		LatestUpdateDraftArg(turn.ToolCalls) == nil &&
		LatestRequestFullRewriteArg(turn.ToolCalls) == nil &&
		LatestUpdateContextArg(turn.ToolCalls) == nil {
		if text := StreamNameOnlyContinuation(ctx, app, sse, assistantModel, hydratedMsgs, turn, textID); text != "" {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: text})
			turnWriter.Write(parts)
		}
	}

	// 1. update_context confirmation card (ends turn; waits for user decision).
	if ctxArgs := LatestUpdateContextArg(turn.ToolCalls); ctxArgs != nil {
		proposed := ApplyContextOps(spec, *ctxArgs)
		if confData, err := json.Marshal(prompts.ContextConfirmationData{Spec: proposed, Reason: strings.TrimSpace(ctxArgs.Reason)}); err == nil {
			sse.DataPart(strings.TrimPrefix(prompts.ContextConfirmationPartType, "data-"), json.RawMessage(confData), false)
			parts = append(parts, api.UIMessagePart{Type: prompts.ContextConfirmationPartType, Data: confData})
			turnWriter.Write(parts)
		}
		sse.Finish()
		return nil
	}

	// 2. request_full_rewrite confirmation card (ends turn; waits for user decision).
	if rwArgs := LatestRequestFullRewriteArg(turn.ToolCalls); rwArgs != nil {
		if confData, err := json.Marshal(prompts.FullRewriteConfirmationData{Reason: strings.TrimSpace(rwArgs.Reason)}); err == nil {
			sse.DataPart(strings.TrimPrefix(prompts.FullRewriteConfirmationPartType, "data-"), json.RawMessage(confData), false)
			parts = append(parts, api.UIMessagePart{Type: prompts.FullRewriteConfirmationPartType, Data: confData})
			turnWriter.Write(parts)
		}
		sse.Finish()
		return nil
	}

	// 3. write_draft (initial first draft OR post-confirmation full replacement).
	if wdArgs := LatestWriteDraftArg(turn.ToolCalls); wdArgs != nil {
		content := strings.TrimSpace(wdArgs.Content)
		if _, err := writeDraftToCandidate(ctx, app, refRec, content, pinned, spec, suggestedName, assistantModel); err != nil {
			emitProjectionTurnError(sse, turnWriter, &parts, "write_draft_failed", err.Error())
		} else {
			if data, err := json.Marshal(prompts.DraftUpdatedData{EditsCount: 0, Summary: "Wrote the document draft."}); err == nil {
				sse.DataPart(strings.TrimPrefix(prompts.DraftUpdatedPartType, "data-"), json.RawMessage(data), false)
				parts = append(parts, api.UIMessagePart{Type: prompts.DraftUpdatedPartType, Data: data})
				turnWriter.Write(parts)
			}
		}
		sse.Finish()
		return nil
	}

	// 4. propose_edit (surgical inline hunk via ProposeRefineEdit / ReviseProposalEdit).
	if HasProposeEditCall(turn.ToolCalls) && projID != "" && snapRec != nil {
		latestNotice, _ := LatestRefineTargetNotice(allMsgs)
		for _, tc := range turn.ToolCalls {
			if tc.Name != prompts.ProposeEditToolName {
				continue
			}
			var args prompts.ProposeEditArgs
			if err := json.Unmarshal(tc.Args, &args); err != nil {
				continue
			}
			executeProposeEdit(ctx, app, sse, refRec, turnWriter, &parts, &allMsgs, projID, snapRec.Id, latestNotice, args)
		}
	}

	// 5. update_draft (1-call anchored rewrite + DiffAndMarkBlocks + full-rewrite threshold).
	if udArgs := LatestUpdateDraftArg(turn.ToolCalls); udArgs != nil && snapRec != nil {
		executeAnchoredUpdateDraft(ctx, app, sse, refRec, snapRec, turnWriter, &parts, standingBrief, pinned, spec, udArgs.Instructions, parentModel)
	}

	sse.Finish()
	return nil
}

func emitProjectionTurnError(sse *chat.SSE, w *chat.TurnWriter, parts *[]api.UIMessagePart, kind, message string) {
	data, err := json.Marshal(map[string]string{"kind": kind, "message": message})
	if err != nil {
		return
	}
	sse.DataPart("refine_error", json.RawMessage(data), false)
	*parts = append(*parts, api.UIMessagePart{Type: "data-refine_error", Data: data})
	w.Write(*parts)
}

func executeProposeEdit(
	ctx context.Context,
	app core.App,
	sse *chat.SSE,
	refRec *core.Record,
	turnWriter *chat.TurnWriter,
	parts *[]api.UIMessagePart,
	allMsgs *[]api.UIMessage,
	projID, snapID string,
	latestNotice RefineTargetNoticeData,
	args prompts.ProposeEditArgs,
) {
	var res projections.EditResult
	var proposeErr error

	var edits []api.SnapshotEdit
	if freshSnap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID); err == nil {
		edits = engine.LoadSnapshotEdits(freshSnap)
	}

	targetID := ResolveNoticeEditID(edits, latestNotice.EditID)
	if targetID != "" && (strings.TrimSpace(args.Target) == "" || strings.TrimSpace(args.Target) == strings.TrimSpace(latestNotice.Passage)) {
		res, proposeErr = projections.ReviseProposalEdit(ctx, app, projID, snapID, targetID, args.Replacement)
	} else if strings.TrimSpace(args.Target) != "" {
		res, proposeErr = projections.ProposeRefineEdit(ctx, app, projID, snapID, args.Target, args.Replacement)
	} else {
		proposeErr = projections.ErrTargetNotFound
	}

	var resultPayload map[string]any
	if proposeErr != nil {
		logger().Error("projection chat: propose_edit failed", "error", proposeErr)
		resultPayload = map[string]any{"ok": false, "error": proposeErr.Error()}
	} else {
		resultPayload = map[string]any{"ok": true, "editId": res.Edit.ID, "sequence": res.Edit.Sequence}
	}

	if resultData, err := json.Marshal(resultPayload); err == nil {
		sse.DataPart(strings.TrimPrefix(prompts.RefineResultPartType, "data-"), json.RawMessage(resultData), false)
		*parts = append(*parts, api.UIMessagePart{Type: prompts.RefineResultPartType, Data: resultData})
		turnWriter.Write(*parts)

		noticeText := prompts.RefineProposalSuccessNotice(res.Edit.Sequence)
		if proposeErr != nil {
			noticeText = prompts.RefineProposalFailureNotice(proposeErr.Error())
		}
		noticeMsg := api.UIMessage{
			ID:   fmt.Sprintf("refine-proposal-%d", time.Now().UnixNano()),
			Role: "system",
			Parts: []api.UIMessagePart{{
				Type: prompts.RefineProposalResultPartType,
				Text: noticeText,
				Data: resultData,
			}},
		}
		if _, err := chat.PersistMessage(ctx, app, refRec, noticeMsg, ""); err != nil {
			logger().Error("projection chat: persist proposal notice failed", "error", err)
		}
		*allMsgs = append(*allMsgs, noticeMsg)
	}
}

func executeAnchoredUpdateDraft(
	ctx context.Context,
	app core.App,
	sse *chat.SSE,
	refRec, snapRec *core.Record,
	turnWriter *chat.TurnWriter,
	parts *[]api.UIMessagePart,
	standingBrief string,
	pinned llmcontext.PinnedIDs,
	spec api.ContextSpec,
	instructions string,
	parentModel string,
) {
	applyModel, err := llm.ResolveRoleFor(llm.RoleSnapshot, parentModel)
	if err != nil {
		emitProjectionTurnError(sse, turnWriter, parts, "apply_failed", "no model configured for draft update")
		return
	}

	freshSnap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapRec.Id)
	if err != nil {
		emitProjectionTurnError(sse, turnWriter, parts, "apply_failed", "pending draft not found")
		return
	}
	priorEdits := engine.LoadSnapshotEdits(freshSnap)
	baseline := engine.ResolveDraftBaseline(freshSnap.GetString("output_draft"), priorEdits)

	var sourceBlock string
	if !pinned.IsEmpty() {
		sourceBlock, _ = llmcontext.HydrateIDsToText(ctx, app, pinned)
	}

	prompt := prompts.AnchoredUpdateDraftPrompt(baseline, standingBrief, sourceBlock, instructions)
	if err := llm.CheckPromptFits(applyModel, len(prompt)); err != nil {
		emitProjectionTurnError(sse, turnWriter, parts, "context_too_large", err.Error())
		return
	}

	updated, err := usage.GenerateOnce(ctx, app, prompt, llm.RoleSnapshot, applyModel, nil)
	if err != nil {
		emitProjectionTurnError(sse, turnWriter, parts, "apply_failed", "updating the draft failed — send another message to retry")
		return
	}
	updated = strings.TrimSpace(updated)
	if updated == "" {
		emitProjectionTurnError(sse, turnWriter, parts, "apply_failed", "model returned empty updated draft")
		return
	}

	// Threshold gate: if the rewrite replaces > 60% of a multi-block draft,
	// hold the body and ask the user to confirm before replacing it cleanly.
	if engine.ExceedsFullRewriteThreshold(baseline, updated) {
		ratio := engine.ChangedBlockRatio(baseline, updated)
		conf := prompts.FullRewriteConfirmationData{
			Reason:          "This update rewrites most of the document. Replace the full draft cleanly?",
			ChangedPercent:  int(math.Round(ratio * 100)),
			ProposedContent: updated,
		}
		if confData, err := json.Marshal(conf); err == nil {
			sse.DataPart(strings.TrimPrefix(prompts.FullRewriteConfirmationPartType, "data-"), json.RawMessage(confData), false)
			*parts = append(*parts, api.UIMessagePart{Type: prompts.FullRewriteConfirmationPartType, Data: confData})
			turnWriter.Write(*parts)
		}
		return
	}

	newDraft, newEdits := engine.DiffAndMarkBlocks(baseline, updated, api.EditTypeRefinement)
	if err := applyDiffedUpdateToCandidate(ctx, app, refRec, freshSnap, priorEdits, newDraft, updated, newEdits, pinned, spec, applyModel); err != nil {
		emitProjectionTurnError(sse, turnWriter, parts, "apply_failed", err.Error())
		return
	}

	if data, err := json.Marshal(prompts.DraftUpdatedData{EditsCount: len(newEdits)}); err == nil {
		sse.DataPart(strings.TrimPrefix(prompts.DraftUpdatedPartType, "data-"), json.RawMessage(data), false)
		*parts = append(*parts, api.UIMessagePart{Type: prompts.DraftUpdatedPartType, Data: data})
		turnWriter.Write(*parts)
	}
}

func applyConfirmedFullRewrite(
	ctx context.Context,
	app core.App,
	refRec *core.Record,
	w http.ResponseWriter,
	proposedContent string,
	pinned llmcontext.PinnedIDs,
	spec api.ContextSpec,
	parentModel string,
) error {
	textID := fmt.Sprintf("full-rewrite-%d", time.Now().UnixNano())
	sse := chat.BeginSSE(w, textID)
	model, _ := llm.ResolveRoleFor(llm.RoleSnapshot, parentModel)

	turnWriter := chat.NewTurnWriter(ctx, app, refRec, textID, model)
	var parts []api.UIMessagePart

	if _, err := writeDraftToCandidate(ctx, app, refRec, proposedContent, pinned, spec, "", model); err != nil {
		emitProjectionTurnError(sse, turnWriter, &parts, "write_draft_failed", err.Error())
		sse.Finish()
		return nil
	}

	if data, err := json.Marshal(prompts.DraftUpdatedData{EditsCount: 0, Summary: "Replaced the draft with the full rewrite."}); err == nil {
		sse.DataPart(strings.TrimPrefix(prompts.DraftUpdatedPartType, "data-"), json.RawMessage(data), false)
		parts = append(parts, api.UIMessagePart{Type: prompts.DraftUpdatedPartType, Data: data})
		turnWriter.Write(parts)
	}

	sse.Finish()
	return nil
}

// writeDraftToCandidate writes clean content onto the bound pending candidate
// (or creates and binds a fresh pending candidate if none exists yet).
func writeDraftToCandidate(
	ctx context.Context,
	app core.App,
	refRec *core.Record,
	content string,
	pinned llmcontext.PinnedIDs,
	spec api.ContextSpec,
	suggestedName string,
	model string,
) (string, error) {
	projID := refRec.GetString("projection_id")
	if projID == "" {
		return "", fmt.Errorf("refinement missing projection_id")
	}

	snapID := refRec.GetString("projection_snapshot_id")
	if snapID != "" {
		if snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID); err == nil && snapRec.GetString("status") == engine.StatusPending {
			priorEdits := engine.LoadSnapshotEdits(snapRec)
			now := time.Now().UTC().Format(time.RFC3339)
			undoableFalse := false
			for i := range priorEdits {
				priorEdits[i].Status = api.EditStatusSuperseded
				priorEdits[i].UndoReason = "full rewrite"
				priorEdits[i].Undoable = &undoableFalse
				priorEdits[i].UpdatedAt = now
			}
			snapRec.Set("output_draft", content)
			snapRec.Set("output_raw", content)
			snapRec.Set("edits", pbutil.JSONObject(priorEdits))
			snapRec.Set("context_spec", pbutil.JSONObject(spec))
			snapRec.Set("resolved_context", pbutil.JSONObject(pinned))
			if model != "" {
				snapRec.Set("generated_by_model", model)
			}
			if err := app.Save(snapRec); err != nil {
				return "", err
			}
			return snapRec.Id, nil
		}
	}

	var newSnapID string
	err := app.RunInTransaction(func(tx core.App) error {
		parentRec, err := tx.FindRecordById(schema.ColProjection.String(), projID)
		if err != nil {
			return err
		}
		strat := projections.Strategy{}
		sID, err := engine.AppendSnapshot(ctx, tx, strat, engine.SnapshotSpec{
			SourceID:                parentRec.Id,
			LensID:                  parentRec.GetString("current_lens_id"),
			Output:                  "",
			OutputDraft:             content,
			OutputRaw:               content,
			Edits:                   []api.SnapshotEdit{},
			ContextSpec:             spec,
			ResolvedContext:         pinned,
			Status:                  engine.StatusPending,
			Model:                   model,
			CreatedFromRefinementID: refRec.Id,
		})
		if err != nil {
			return err
		}
		if err := engine.DiscardOtherPending(tx, strat, parentRec.Id, nil, sID); err != nil {
			return err
		}
		newSnapID = sID
		refRec.Set("projection_snapshot_id", newSnapID)
		if err := tx.Save(refRec); err != nil {
			return err
		}
		if suggestedName != "" && (parentRec.GetString("name") == "" || strings.HasPrefix(parentRec.GetString("name"), "Untitled")) {
			parentRec.Set("name", suggestedName)
			return tx.Save(parentRec)
		}
		return nil
	})
	return newSnapID, err
}

func applyDiffedUpdateToCandidate(
	ctx context.Context,
	app core.App,
	refRec, snapRec *core.Record,
	priorEdits []api.SnapshotEdit,
	newDraft, outputRaw string,
	newEdits []api.SnapshotEdit,
	pinned llmcontext.PinnedIDs,
	spec api.ContextSpec,
	model string,
) error {
	maxSeq := 0
	var supersededSeqs, keptSeqs []int
	now := time.Now().UTC().Format(time.RFC3339)
	undoableFalse := false

	for i := range priorEdits {
		e := &priorEdits[i]
		if e.Sequence > maxSeq {
			maxSeq = e.Sequence
		}
		if e.Status == api.EditStatusApproved && e.InlinedText != "" && strings.Contains(newDraft, e.InlinedText) {
			if idx := engine.BlockRunIndex(newDraft, e.InlinedText); idx >= 0 {
				e.BlockIndex = idx
			}
			e.UpdatedAt = now
			keptSeqs = append(keptSeqs, e.Sequence)
			continue
		}
		if e.Status != api.EditStatusSuperseded {
			supersededSeqs = append(supersededSeqs, e.Sequence)
		}
		e.Status = api.EditStatusSuperseded
		e.UndoReason = "updated draft"
		e.Undoable = &undoableFalse
		e.UpdatedAt = now
	}

	for i := range newEdits {
		newEdits[i].Sequence = maxSeq + 1 + i
	}
	combinedEdits := append(priorEdits, newEdits...)

	snapRec.Set("output_draft", newDraft)
	snapRec.Set("output_raw", outputRaw)
	snapRec.Set("edits", pbutil.JSONObject(combinedEdits))
	snapRec.Set("context_spec", pbutil.JSONObject(spec))
	snapRec.Set("resolved_context", pbutil.JSONObject(pinned))
	if model != "" {
		snapRec.Set("generated_by_model", model)
	}
	if err := app.Save(snapRec); err != nil {
		return err
	}

	if len(supersededSeqs) > 0 || len(keptSeqs) > 0 {
		noticeText := prompts.RegenerateSupersededNotice(supersededSeqs, keptSeqs)
		noticeData, _ := json.Marshal(prompts.RegenerateSupersededData{
			Sequences: supersededSeqs,
			Kept:      keptSeqs,
		})
		msg := api.UIMessage{
			ID:   fmt.Sprintf("superseded-update-%d", time.Now().UnixNano()),
			Role: "system",
			Parts: []api.UIMessagePart{{
				Type: prompts.RegenerateSupersededPartType,
				Text: noticeText,
				Data: noticeData,
			}},
		}
		_, _ = chat.PersistMessage(ctx, app, refRec, msg, "")
	}
	return nil
}

func syncPendingCandidateContext(app core.App, refRec *core.Record, spec api.ContextSpec, pinned llmcontext.PinnedIDs) {
	snapID := refRec.GetString("projection_snapshot_id")
	if snapID == "" {
		return
	}
	snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
	if err != nil || snapRec.GetString("status") != engine.StatusPending {
		return
	}
	snapRec.Set("context_spec", pbutil.JSONObject(spec))
	snapRec.Set("resolved_context", pbutil.JSONObject(pinned))
	if err := app.Save(snapRec); err != nil {
		logger().Warn("projection chat: failed to sync candidate context", "snapshot_id", snapID, "error", err)
	}
}

// formatLiveDraftForModel renders output_draft for the system prompt, expanding
// any unresolved <<<edit:id>>> markers into readable inline annotations so the
// model sees both the baseline text and any pending proposals without raw IDs.
func formatLiveDraftForModel(draft string, edits []api.SnapshotEdit) string {
	if !engine.HasUnresolvedEditMarkers(draft) {
		return draft
	}
	byID := make(map[string]api.SnapshotEdit, len(edits))
	for _, e := range edits {
		byID[e.ID] = e
	}
	out := draft
	for _, e := range edits {
		marker := engine.FormatEditMarker(e.ID)
		if !strings.Contains(out, marker) {
			continue
		}
		var annotation strings.Builder
		annotation.WriteString(fmt.Sprintf("[Pending proposed edit #%d (awaiting user accept/reject):\n", e.Sequence))
		if strings.TrimSpace(e.ContentBefore) != "" {
			annotation.WriteString("Current: " + e.ContentBefore + "\n")
		}
		if strings.TrimSpace(e.ContentAfter) != "" {
			annotation.WriteString("Proposed: " + e.ContentAfter + "\n")
		}
		annotation.WriteString("]")
		out = strings.ReplaceAll(out, marker, annotation.String())
	}
	return out
}
