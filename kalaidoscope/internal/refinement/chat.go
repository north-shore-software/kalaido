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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// StreamTurn executes one turn of the refinement chat conversation, including
// prompt preparation, tool-calling drafting leg, continuation turns, and the
// apply preview leg.
func StreamTurn(ctx context.Context, app core.App, req api.RefinementChatRequest, refRec *core.Record, w http.ResponseWriter) error {
	dbMsgs, _ := chat.LoadMessages(ctx, app, refRec)
	newMsgs := chat.ExtractNewMessages(dbMsgs, req.Messages)

	chat.ResolveContextSpecs(ctx, app, dbMsgs, newMsgs)

	for _, m := range newMsgs {
		if _, err := chat.PersistMessage(ctx, app, refRec, m, ""); err != nil {
			logger().Error("refinement persist message failed", "message_id", m.ID, "error", err)
		}
	}

	allMsgs := append(dbMsgs, newMsgs...)

	// A refinement conversation has no model of its own — it always
	// follows the entity it refines.
	parentModel := ""
	if p := Parent(app, refRec); p != nil {
		parentModel = p.GetString("generate_with_model")
	}

	// A send that carries only a new target window (no user text) asks for
	// the standing lens to be re-applied to that window: the preview moves,
	// the lens does not, and the lens-writer is not consulted.
	if win := ReapplyWindow(newMsgs); win != nil {
		return StreamWindowReapply(ctx, app, refRec, allMsgs, win, parentModel, w)
	}

	if IsRegenerateConfirmed(newMsgs) {
		return StreamRegenerateConfirmed(ctx, app, refRec, allMsgs, parentModel, w)
	}

	if IsRegenerateCancelled(newMsgs) {
		textID := fmt.Sprintf("regen-cancel-%d", time.Now().UnixNano())
		sse := chat.BeginSSE(w, textID)
		sse.Finish()
		return nil
	}

	// Declining a proposed context change only records the refusal (already
	// persisted above); the model hears about it on the next turn. Accepting
	// one is not special-cased: the accepting message carries the new
	// `context_spec`, so the turn continues below with the context changed
	// and the model picks up where it left off.
	if IsContextCancelled(newMsgs) {
		textID := fmt.Sprintf("ctx-cancel-%d", time.Now().UnixNano())
		sse := chat.BeginSSE(w, textID)
		sse.Finish()
		return nil
	}

	_, currentLens := LatestLensPart(allMsgs)
	hasLens := currentLens != ""
	if !hasLens {
		if p := Parent(app, refRec); p != nil {
			if lensID := p.GetString("current_lens_id"); lensID != "" {
				if lensRec, err := app.FindRecordById(schema.ColLens.String(), lensID); err == nil {
					prompt := strings.TrimSpace(lensRec.GetString("prompt"))
					if prompt != "" {
						hasLens = true
						currentLens = prompt
					}
				}
			} else if prompt := strings.TrimSpace(p.GetString("prompt")); prompt != "" {
				hasLens = true
				currentLens = prompt
			}
		}
	}

	hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)
	hydratedMsgs = append([]llm.Message{{Role: "system", Content: prompts.RefinementPrompt(hasLens)}}, hydratedMsgs...)

	if len(hydratedMsgs) == 0 {
		return ErrMessagesRequired
	}

	assistantModel, err := llm.ResolveRoleFor(llm.RoleRefinement, parentModel)
	if err != nil {
		return ErrNoModel
	}

	if err := llm.CheckPromptFits(assistantModel, llm.MessagesChars(hydratedMsgs)); err != nil {
		logger().Warn("refinement chat prompt too large", "refinement_id", refRec.Id, "error", err)
		return err
	}

	var tools []llm.Tool
	if hasLens {
		tools = []llm.Tool{UpdateLensTool, RegenerateFromLensTool, RefineCandidateTool, UpdateContextTool}
	} else {
		tools = []llm.Tool{UpdateLensTool, SuggestNameTool, RefineCandidateTool, UpdateContextTool}
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

	if turn.Text == "" && len(turn.ToolCalls) > 0 && LatestUpdateLensArg(turn.ToolCalls) == nil && LatestRefineCandidateArg(turn.ToolCalls) == nil && !HasRegenerateFromLensCall(turn.ToolCalls) && LatestUpdateContextArg(turn.ToolCalls) == nil {
		if text := StreamNameOnlyContinuation(ctx, app, sse, assistantModel, hydratedMsgs, turn, textID); text != "" {
			parts = append(parts, api.UIMessagePart{Type: "text", Text: text})
			turnWriter.Write(parts)
		} else {
			logger().Warn("refinement chat: name-only turn produced no text on continuation", "refinement_id", refRec.Id)
		}
	}

	latestNotice, _ := LatestRefineTargetNotice(allMsgs)

	for _, tc := range turn.ToolCalls {
		if tc.Name == prompts.RefineCandidateToolName {
			var args prompts.RefineCandidateArgs
			if err := json.Unmarshal(tc.Args, &args); err == nil {
				projID := refRec.GetString("projection_id")
				snapID := refRec.GetString("projection_snapshot_id")
				if projID != "" && snapID != "" {
					var res projections.EditResult
					var proposeErr error

					var edits []api.SnapshotEdit
					if snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID); err == nil {
						edits = engine.LoadSnapshotEdits(snapRec)
					}

					targetID := ResolveNoticeEditID(edits, latestNotice.EditID)
					if targetID != "" {
						res, proposeErr = projections.ReviseProposalEdit(ctx, app, projID, snapID, targetID, args.Replacement)
					} else if args.Target != "" {
						res, proposeErr = projections.ProposeRefineEdit(ctx, app, projID, snapID, args.Target, args.Replacement)
					} else {
						proposeErr = projections.ErrTargetNotFound
					}

					var resultPayload map[string]any
					if proposeErr != nil {
						logger().Error("refinement chat: propose refine edit failed", "error", proposeErr)
						resultPayload = map[string]any{
							"ok":    false,
							"error": proposeErr.Error(),
						}
					} else {
						resultPayload = map[string]any{
							"ok":       true,
							"editId":   res.Edit.ID,
							"sequence": res.Edit.Sequence,
						}
					}

					if resultData, err := json.Marshal(resultPayload); err == nil {
						sse.DataPart(strings.TrimPrefix(prompts.RefineResultPartType, "data-"), json.RawMessage(resultData), false)
						parts = append(parts, api.UIMessagePart{Type: prompts.RefineResultPartType, Data: resultData})
						turnWriter.Write(parts)

						var noticeText string
						if proposeErr != nil {
							noticeText = prompts.RefineProposalFailureNotice(proposeErr.Error())
						} else {
							noticeText = prompts.RefineProposalSuccessNotice(res.Edit.Sequence)
						}
						noticeMsg := api.UIMessage{
							ID:   fmt.Sprintf("refine-proposal-%d", time.Now().UnixNano()),
							Role: "system",
							Parts: []api.UIMessagePart{
								{
									Type: prompts.RefineProposalResultPartType,
									Text: noticeText,
									Data: resultData,
								},
							},
						}
						if _, err := chat.PersistMessage(ctx, app, refRec, noticeMsg, ""); err != nil {
							logger().Error("refinement chat: persist proposal notice failed", "error", err)
						}
						allMsgs = append(allMsgs, noticeMsg)
					}
				}
			}
		}
	}

	if updateArgs := LatestUpdateLensArg(turn.ToolCalls); updateArgs != nil {
		compiled, err := CompileLens(ctx, app, assistantModel, hydratedMsgs, currentLens, updateArgs.Directive)
		if err != nil {
			logger().Error("refinement chat: compile lens failed", "error", err)
		} else {
			currentLens = compiled
			lensData, _ := json.Marshal(prompts.LensPartData{Lens: compiled})
			sse.DataPart("lens", json.RawMessage(lensData), false)
			parts = append(parts, api.UIMessagePart{Type: prompts.LensPartType, Data: lensData})
			turnWriter.Write(parts)

			if match := LensCountPin(compiled); match != "" {
				logger().Warn("refinement chat: drafted lens pins a count", "refinement_id", refRec.Id, "match", match)
				if data, err := json.Marshal(map[string]string{"match": match}); err == nil {
					sse.DataPart("refine_lint", json.RawMessage(data), false)
					parts = append(parts, api.UIMessagePart{Type: "data-refine_lint", Data: data})
					turnWriter.Write(parts)
				}
			}
		}
	}

	// A proposed context change ends the turn: the spec that would take
	// effect goes to the client for the user to confirm, and nothing is
	// applied against a context the user has not agreed to. A lens compiled
	// on the same turn (against the prompt's instruction) is kept — it was
	// persisted above — but not applied until the model regenerates.
	if ctxArgs := LatestUpdateContextArg(turn.ToolCalls); ctxArgs != nil {
		_, currentSpec, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
		proposed := ApplyContextOps(currentSpec, *ctxArgs)
		confData, err := json.Marshal(prompts.ContextConfirmationData{Spec: proposed, Reason: strings.TrimSpace(ctxArgs.Reason)})
		if err == nil {
			sse.DataPart(strings.TrimPrefix(prompts.ContextConfirmationPartType, "data-"), json.RawMessage(confData), false)
			parts = append(parts, api.UIMessagePart{Type: prompts.ContextConfirmationPartType, Data: confData})
			turnWriter.Write(parts)
		}
		sse.Finish()
		return nil
	}

	if (!hasLens || HasRegenerateFromLensCall(turn.ToolCalls)) && currentLens != "" {
		if HasRegenerateFromLensCall(turn.ToolCalls) {
			snapID := refRec.GetString("projection_snapshot_id")
			var approvedEdits []api.SnapshotEdit
			if snapID != "" {
				if snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID); err == nil {
					for _, e := range engine.LoadSnapshotEdits(snapRec) {
						if e.Status == api.EditStatusApproved {
							approvedEdits = append(approvedEdits, e)
						}
					}
				}
			}
			if len(approvedEdits) > 0 {
				confData, _ := json.Marshal(prompts.RegenerateConfirmationData{AffectedEdits: approvedEdits})
				sse.DataPart(strings.TrimPrefix(prompts.RegenerateConfirmationPartType, "data-"), json.RawMessage(confData), false)
				parts = append(parts, api.UIMessagePart{Type: prompts.RegenerateConfirmationPartType, Data: confData})
				turnWriter.Write(parts)
				sse.Finish()
				return nil
			}
		}

		pinned, spec, win := llmcontext.LatestPinnedAndSpec(allMsgs)
		suggestedName := extractSuggestedName(turn.ToolCalls)
		StreamApplyLeg(ctx, app, sse, refRec, turnWriter, parts, currentLens, pinned, spec, suggestedName, win, parentModel)
	}

	sse.Finish()
	return nil
}

// StreamNameOnlyContinuation makes the follow-up model call for a turn that
// called suggest_name and nothing else, streaming its text into the open SSE
// response. No tools are advertised, so the reply is the plain-text question
// the turn owes. Returns the text, or "" if the call failed or stayed silent.
func StreamNameOnlyContinuation(ctx context.Context, app core.App, sse *chat.SSE, model string, msgs []llm.Message, turn chat.AssistantTurn, textID string) string {
	names := make([]string, 0, len(turn.ToolCalls))
	for _, tc := range turn.ToolCalls {
		names = append(names, tc.Name)
	}
	msgs = append(msgs,
		llm.Message{Role: "assistant", Content: strings.TrimSpace(prompts.DiscoverEchoToolCalls(names))},
		llm.Message{Role: "user", Content: prompts.NameRecordedContinue})
	if err := llm.CheckPromptFits(model, llm.MessagesChars(msgs)); err != nil {
		logger().Warn("refinement continuation prompt too large", "error", err)
		return ""
	}
	comp, err := usage.Stream(ctx, app, llm.RoleRefinement, model, msgs, nil)
	if err != nil {
		logger().Error("refinement continuation failed", "error", err)
		return ""
	}
	return sse.StreamTurn(comp, textID+"-c1", nil).Text
}

// ReapplyWindow is the window a re-apply send names: the new messages hold no
// user turn, and one of them is a system message carrying a `window` part.
func ReapplyWindow(newMsgs []api.UIMessage) *api.Window {
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

func IsRegenerateConfirmed(newMsgs []api.UIMessage) bool {
	for _, m := range newMsgs {
		if m.Role == "user" {
			return false
		}
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			if p.Type == prompts.RegenerateConfirmPartType {
				return true
			}
		}
	}
	return false
}

func IsRegenerateCancelled(newMsgs []api.UIMessage) bool {
	for _, m := range newMsgs {
		if m.Role == "user" {
			return false
		}
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			if p.Type == prompts.RegenerateCancelPartType {
				return true
			}
		}
	}
	return false
}

func LatestLensPart(msgs []api.UIMessage) (api.UIMessagePart, string) {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "assistant" {
			continue
		}
		for _, p := range msgs[i].Parts {
			if p.Type == prompts.LensPartType {
				var data prompts.LensPartData
				if err := json.Unmarshal(p.Data, &data); err == nil && strings.TrimSpace(data.Lens) != "" {
					return p, strings.TrimSpace(data.Lens)
				}
			}
			if p.Type == "tool-"+prompts.UpdateLensToolName {
				var data api.ToolPartData
				if err := json.Unmarshal(p.Data, &data); err != nil {
					continue
				}
				var legacy struct {
					Lens string `json:"lens"`
				}
				if err := json.Unmarshal(data.Input, &legacy); err == nil && strings.TrimSpace(legacy.Lens) != "" {
					return p, strings.TrimSpace(legacy.Lens)
				}
			}
		}
	}
	return api.UIMessagePart{}, ""
}

type RefineTargetNoticeData struct {
	Passage string `json:"passage"`
	EditID  string `json:"editId,omitempty"`
}

func LatestRefineTargetNotice(msgs []api.UIMessage) (RefineTargetNoticeData, bool) {
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role != "system" {
			continue
		}
		for _, p := range m.Parts {
			if p.Type == prompts.RefineTargetPartType && len(p.Data) > 0 {
				var d RefineTargetNoticeData
				if err := json.Unmarshal(p.Data, &d); err == nil {
					return d, true
				}
			}
		}
	}
	return RefineTargetNoticeData{}, false
}

func ResolveNoticeEditID(edits []api.SnapshotEdit, noticeEditID string) string {
	if noticeEditID == "" {
		return ""
	}
	lookup := make(map[string]api.SnapshotEdit, len(edits))
	for _, e := range edits {
		lookup[e.ID] = e
	}
	curr, ok := lookup[noticeEditID]
	if !ok {
		return ""
	}
	if curr.Status == api.EditStatusProposed {
		return curr.ID
	}
	if curr.Status != api.EditStatusSuperseded {
		return ""
	}
	seen := make(map[string]bool, len(edits))
	seen[curr.ID] = true
	for curr.SupersededBy != "" && !seen[curr.SupersededBy] {
		next, ok := lookup[curr.SupersededBy]
		if !ok {
			return ""
		}
		seen[next.ID] = true
		if next.Status == api.EditStatusProposed {
			return next.ID
		}
		if next.Status != api.EditStatusSuperseded {
			return ""
		}
		curr = next
	}
	return ""
}

func StreamWindowReapply(ctx context.Context, app core.App, refRec *core.Record, allMsgs []api.UIMessage, win *api.Window, parentModel string, w http.ResponseWriter) error {
	textID := fmt.Sprintf("reapply-%d", time.Now().UnixNano())
	sse := chat.BeginSSE(w, textID)

	lensPart, lens := LatestLensPart(allMsgs)
	if lens == "" {
		sse.Finish()
		return nil
	}

	marker, _ := json.Marshal(map[string]string{"start": win.Start, "end": win.End})
	sse.DataPart(strings.TrimPrefix(llmcontext.WindowReapplyPartType, "data-"), json.RawMessage(marker), false)

	var replayed api.UIMessagePart
	if lensPart.Type == prompts.LensPartType {
		lensData, _ := json.Marshal(prompts.LensPartData{Lens: lens})
		sse.DataPart("lens", json.RawMessage(lensData), false)
		replayed = api.UIMessagePart{Type: prompts.LensPartType, Data: lensData}
	} else {
		var lensCall api.ToolPartData
		_ = json.Unmarshal(lensPart.Data, &lensCall)
		replayID := fmt.Sprintf("%s-reapply", lensCall.ToolCallID)
		sse.ToolInputStart(replayID, prompts.UpdateLensToolName)
		sse.ToolInputAvailable(replayID, prompts.UpdateLensToolName, lensCall.Input)
		replayed, _ = chat.ToolCallPart(llm.ToolCall{ID: replayID, Name: prompts.UpdateLensToolName, Args: lensCall.Input})
	}

	parts := []api.UIMessagePart{
		{Type: llmcontext.WindowReapplyPartType, Data: marker},
		replayed,
	}
	turnWriter := chat.NewTurnWriter(ctx, app, refRec, textID, "")
	turnWriter.Write(parts)

	pinned, spec, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
	StreamApplyLeg(ctx, app, sse, refRec, turnWriter, parts, lens, pinned, spec, "", win, parentModel)
	sse.Finish()
	return nil
}

func StreamRegenerateConfirmed(ctx context.Context, app core.App, refRec *core.Record, allMsgs []api.UIMessage, parentModel string, w http.ResponseWriter) error {
	textID := fmt.Sprintf("regen-confirm-%d", time.Now().UnixNano())
	sse := chat.BeginSSE(w, textID)

	_, currentLens := LatestLensPart(allMsgs)
	if currentLens == "" {
		if p := Parent(app, refRec); p != nil {
			if lensID := p.GetString("current_lens_id"); lensID != "" {
				if lensRec, err := app.FindRecordById(schema.ColLens.String(), lensID); err == nil {
					prompt := strings.TrimSpace(lensRec.GetString("prompt"))
					if prompt != "" {
						currentLens = prompt
					}
				}
			} else if prompt := strings.TrimSpace(p.GetString("prompt")); prompt != "" {
				currentLens = prompt
			}
		}
	}
	if currentLens == "" {
		sse.Finish()
		return nil
	}

	parts := []api.UIMessagePart{
		{Type: prompts.RegenerateConfirmPartType},
	}
	turnWriter := chat.NewTurnWriter(ctx, app, refRec, textID, "")
	turnWriter.Write(parts)

	pinned, spec, win := llmcontext.LatestPinnedAndSpec(allMsgs)
	StreamApplyLeg(ctx, app, sse, refRec, turnWriter, parts, currentLens, pinned, spec, "", win, parentModel)
	sse.Finish()
	return nil
}

func StreamApplyLeg(ctx context.Context, app core.App, sse *chat.SSE, refRec *core.Record, w *chat.TurnWriter, parts []api.UIMessagePart, lens string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, suggestedName string, win *api.Window, parentModel string) {
	emitTurnError := func(kind, message string) {
		data, err := json.Marshal(map[string]string{"kind": kind, "message": message})
		if err != nil {
			return
		}
		sse.DataPart("refine_error", json.RawMessage(data), false)
		parts = append(parts, api.UIMessagePart{Type: "data-refine_error", Data: data})
		w.Write(parts)
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

	final, err := ApplyDraftLens(ctx, app, applyModel, lens, sourceBlock, win, func(chunk string) {
		sse.ToolInputDelta(applyID, JSONStringChunk(chunk))
	})
	if err != nil {
		logger().Error("refinement chat apply failed", "refinement_id", refRec.Id, "error", err)
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

	// The available event replaces the streamed partial args with the
	// authoritative (trimmed) output.
	sse.ToolInputDelta(applyID, `"}`)
	sse.ToolInputAvailable(applyID, prompts.ApplyResultToolName, map[string]string{"output": final})

	if args, err := json.Marshal(map[string]string{"output": final}); err == nil {
		if part, ok := chat.ToolCallPart(llm.ToolCall{ID: applyID, Name: prompts.ApplyResultToolName, Args: args}); ok {
			parts = append(parts, part)
			w.Write(parts)
		}
	}

	_, _ = MaterializeCandidateIfNew(ctx, app, refRec, lens, final, pinned, spec, suggestedName, applyModel)
}

func extractSuggestedName(toolCalls []llm.ToolCall) string {
	for _, tc := range toolCalls {
		if tc.Name == prompts.SuggestNameToolName {
			var args struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(tc.Args, &args) == nil && strings.TrimSpace(args.Name) != "" {
				return strings.TrimSpace(args.Name)
			}
		}
		if tc.Name == prompts.UpdateLensToolName {
			var args struct {
				SuggestedName string `json:"suggested_name"`
			}
			if json.Unmarshal(tc.Args, &args) == nil && strings.TrimSpace(args.SuggestedName) != "" {
				return strings.TrimSpace(args.SuggestedName)
			}
		}
	}
	return ""
}
