package refinement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// LensSeedPartType marks the assistant turn a reflection refinement is seeded
// with: the reflection's current lens and, when the window has one, its
// approved output. The client renders it as "starting from the current lens"
// rather than as a drafted change.
const LensSeedPartType = "data-lens_seed"

var (
	ErrNoDraftedLens   = errors.New("no drafted lens found in chat")
	ErrNoPreviewOutput = errors.New("the latest lens has no generated preview — send another message to regenerate")
	ErrMissingParentID = errors.New("refinement missing parent target id")
	ErrParentMismatch  = errors.New("refinement parent target id mismatch")
)

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// SeedLensTurn builds the initial turn for a reflection refinement: its current
// lens paired with approved output for win.
func SeedLensTurn(app core.App, parent *core.Record, win *api.Window) (api.UIMessage, bool) {
	lensID := parent.GetString("current_lens_id")
	if lensID == "" {
		return api.UIMessage{}, false
	}
	lensRec, err := app.FindRecordById(schema.ColLens.String(), lensID)
	if err != nil {
		return api.UIMessage{}, false
	}
	lens := strings.TrimSpace(lensRec.GetString("prompt"))
	if lens == "" {
		return api.UIMessage{}, false
	}

	now := time.Now().UnixNano()
	parts := []api.UIMessagePart{{Type: LensSeedPartType, Data: json.RawMessage(`{}`)}}
	if p, ok := chat.ToolCallPart(llm.ToolCall{
		ID:   fmt.Sprintf("seed-lens-%d", now),
		Name: prompts.UpdateLensToolName,
		Args: mustJSON(map[string]string{"lens": lens}),
	}); ok {
		parts = append(parts, p)
	}
	if win != nil {
		filter, params := engine.ApprovedSnapshotFilter(reflections.Strategy{}, parent.Id, win)
		if snaps, err := app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(), filter, "-approval_sequence_number", 1, 0, params); err == nil && len(snaps) > 0 {
			if output := strings.TrimSpace(snaps[0].GetString("output")); output != "" {
				if p, ok := chat.ToolCallPart(llm.ToolCall{
					ID:   fmt.Sprintf("seed-apply-%d", now),
					Name: prompts.ApplyResultToolName,
					Args: mustJSON(map[string]string{"output": output}),
				}); ok {
					parts = append(parts, p)
				}
			}
		}
	}
	return api.UIMessage{ID: fmt.Sprintf("seed-%d", now), Role: "assistant", Parts: parts}, true
}

// ExtractDraftedLensAndSpec reads a refinement conversation's commit payload:
// the newest drafted lens, the applied output produced for that same lens, and
// the latest context.
func ExtractDraftedLensAndSpec(app core.App, refRec *core.Record) (lens, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, win *api.Window, err error) {
	msgs, err := chat.LoadMessages(nil, app, refRec)
	if err != nil {
		return "", "", llmcontext.PinnedIDs{}, api.ContextSpec{}, nil, err
	}

	pinned, spec, win = llmcontext.LatestPinnedAndSpec(msgs)

	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role != "assistant" {
			continue
		}
		for _, p := range m.Parts {
			switch p.Type {
			case prompts.LensPartType:
				var data prompts.LensPartData
				if err := json.Unmarshal(p.Data, &data); err == nil && strings.TrimSpace(data.Lens) != "" {
					lens = strings.TrimSpace(data.Lens)
				}
			case "tool-" + prompts.UpdateLensToolName:
				var data struct {
					Input struct {
						Lens string `json:"lens"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil {
					lens = strings.TrimSpace(data.Input.Lens)
				}
			case "tool-" + prompts.ApplyResultToolName:
				var data struct {
					Input struct {
						Output string `json:"output"`
					} `json:"input"`
				}
				if err := json.Unmarshal(p.Data, &data); err == nil {
					output = strings.TrimSpace(data.Input.Output)
				}
			}
		}
		if lens != "" {
			return lens, output, pinned, spec, win, nil
		}
		output = ""
	}

	scanned := make([]string, 0, len(msgs))
	for _, m := range msgs {
		for _, p := range m.Parts {
			scanned = append(scanned, m.Role+"/"+p.Type)
		}
	}
	logger().Warn("refinement extract: no drafted lens",
		"refinement_id", refRec.Id, "count", len(msgs), "scanned", strings.Join(scanned, ", "))

	return "", "", pinned, spec, win, nil
}

// CreateProjectionRefinement creates a projection refinement record and seeds it.
func CreateProjectionRefinement(app core.App, clientID, targetID, snapshotID string, contextSpec *api.ContextSpec) (string, []api.UIMessage, error) {
	var refID string
	var seeded []api.UIMessage

	err := app.RunInTransaction(func(txApp core.App) error {
		col, err := txApp.FindCollectionByNameOrId(schema.ColProjectionRefinement.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("external_conversation_id", clientID)

		parent, err := projections.FindLive(txApp, targetID)
		if err != nil {
			return err
		}
		rec.Set("projection_id", targetID)

		var snap *core.Record
		if snapshotID != "" {
			rec.Set("projection_snapshot_id", snapshotID)
			snap, err = txApp.FindRecordById(schema.ColProjectionSnapshot.String(), snapshotID)
			if err != nil {
				return err
			}
		}

		if err := txApp.Save(rec); err != nil {
			return err
		}
		refID = rec.Id

		var ctxSpec *api.ContextSpec
		switch {
		case contextSpec != nil:
			ctxSpec = contextSpec
		case snap != nil:
			var fromSnap api.ContextSpec
			if err := snap.UnmarshalJSONField("context_spec", &fromSnap); err == nil {
				ctxSpec = &fromSnap
			}
		}

		var parts []api.UIMessagePart
		if ctxSpec != nil {
			data, _ := json.Marshal(*ctxSpec)
			parts = append(parts, api.UIMessagePart{Type: "context_spec", Data: data})
			if pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), txApp, *ctxSpec, nil); err == nil {
				data, _ := json.Marshal(pinned)
				parts = append(parts, api.UIMessagePart{Type: "pinned_ids", Data: data})
			}
		}

		if len(parts) > 0 {
			msg := api.UIMessage{
				ID:    fmt.Sprintf("ctx-%d", time.Now().UnixNano()),
				Role:  "system",
				Parts: parts,
			}
			if _, err := chat.PersistMessage(context.Background(), txApp, rec, msg, ""); err != nil {
				return err
			}
			seeded = append(seeded, msg)
		}

		if lensMsg, ok := SeedLensTurn(txApp, parent, nil); ok {
			if _, err := chat.PersistMessage(context.Background(), txApp, rec, lensMsg, ""); err != nil {
				return err
			}
			seeded = append(seeded, lensMsg)
		}

		return nil
	})
	return refID, seeded, err
}

// CreateReflectionRefinement creates a reflection refinement record and seeds it.
func CreateReflectionRefinement(app core.App, clientID, targetID string, reqWindow *api.Window, contextSpec *api.ContextSpec) (string, []api.UIMessage, error) {
	var refID string
	var seeded []api.UIMessage

	err := app.RunInTransaction(func(txApp core.App) error {
		col, err := txApp.FindCollectionByNameOrId(schema.ColReflectionRefinement.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("external_conversation_id", clientID)
		rec.Set("reflection_id", targetID)

		parent, err := reflections.FindLive(txApp, targetID)
		if err != nil {
			return err
		}

		if err := txApp.Save(rec); err != nil {
			return err
		}
		refID = rec.Id

		var ctxSpec *api.ContextSpec
		switch {
		case contextSpec != nil:
			ctxSpec = contextSpec
		case parent != nil:
			var fromParent api.ContextSpec
			if raw := parent.GetString("current_context_spec"); raw != "" && raw != "null" {
				if err := parent.UnmarshalJSONField("current_context_spec", &fromParent); err == nil {
					ctxSpec = &fromParent
				}
			}
		}

		var win *api.Window
		if reqWindow != nil && reqWindow.Start != "" && reqWindow.End != "" {
			win = &api.Window{Start: reqWindow.Start, End: reqWindow.End}
		} else {
			win = reflections.DefaultRefinementWindow(parent, time.Now())
		}
		if win != nil {
			win.ID = reflections.WindowID(targetID, *win)
		}

		var parts []api.UIMessagePart
		if ctxSpec != nil {
			data, _ := json.Marshal(*ctxSpec)
			parts = append(parts, api.UIMessagePart{Type: "context_spec", Data: data})
		}
		if win != nil {
			data, _ := json.Marshal(win)
			parts = append(parts, api.UIMessagePart{Type: "window", Data: data})
		}
		if ctxSpec != nil {
			if pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), txApp, *ctxSpec, win); err == nil {
				data, _ := json.Marshal(pinned)
				parts = append(parts, api.UIMessagePart{Type: "pinned_ids", Data: data})
			}
		}

		if len(parts) > 0 {
			msg := api.UIMessage{
				ID:    fmt.Sprintf("ctx-%d", time.Now().UnixNano()),
				Role:  "system",
				Parts: parts,
			}
			if _, err := chat.PersistMessage(context.Background(), txApp, rec, msg, ""); err != nil {
				return err
			}
			seeded = append(seeded, msg)
		}

		if lensMsg, ok := SeedLensTurn(txApp, parent, win); ok {
			if _, err := chat.PersistMessage(context.Background(), txApp, rec, lensMsg, ""); err != nil {
				return err
			}
			seeded = append(seeded, lensMsg)
		}

		return nil
	})
	return refID, seeded, err
}

// Commit installs the refinement's latest drafted lens as the plan of record.
func Commit(ctx context.Context, app core.App, refRec *core.Record, expectedParentID string, runner workerutil.Runner, enqueueWave func()) (string, error) {
	lens, output, pinned, spec, _, err := ExtractDraftedLensAndSpec(app, refRec)
	if err != nil {
		return "", err
	}
	if lens == "" {
		return "", ErrNoDraftedLens
	}
	strat := strategyFor(refRec)
	parent := parentID(app, refRec, strat)
	if parent == "" {
		return "", ErrMissingParentID
	}
	if expectedParentID != "" && expectedParentID != parent {
		return "", ErrParentMismatch
	}

	sourceSnapID := refRec.GetString(strat.TargetType() + "_snapshot_id")
	if output == "" && sourceSnapID != "" {
		if snap, err := app.FindRecordById(strat.SnapshotCollectionName(), sourceSnapID); err == nil {
			if draft := strings.TrimSpace(snap.GetString("output_draft")); draft != "" {
				output = draft
			} else if approved := strings.TrimSpace(snap.GetString("output")); approved != "" {
				output = approved
			}
		}
	}
	if output == "" {
		return "", ErrNoPreviewOutput
	}

	newSnapID, err := engine.CommitRefinement(ctx, app, strat, parent, sourceSnapID, lens, output, pinned, spec, refRec.Id)
	if err != nil {
		logger().Error("refinement commit failed", "error", err)
		return "", err
	}

	if enqueueWave != nil {
		enqueueWave()
	}

	if _, isReflection := strat.(reflections.Strategy); isReflection {
		logger().Info("refinement installed a new lens", "target_type", strat.TargetType(), "reflection_id", parent, "refinement_id", refRec.Id)
		if runner != nil {
			reflections.RunPendingWindows(runner, app, parent)
		}
	} else {
		logger().Info("refinement committed", "target_type", strat.TargetType(), "id", parent, "refinement_id", refRec.Id, "snapshot_id", newSnapID)
	}

	return newSnapID, nil
}

func MaterializeCandidateIfNew(ctx context.Context, app core.App, refRec *core.Record, lens string, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, suggestedName string, model string) (string, error) {
	if refRec.Collection().Name != schema.ColProjectionRefinement.String() {
		return "", nil
	}
	projID := refRec.GetString("projection_id")
	if projID == "" {
		return "", nil
	}

	snapID := refRec.GetString("projection_snapshot_id")
	if snapID != "" {
		snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
		if err == nil && snapRec.GetString("status") == engine.StatusPending {
			strat := projections.Strategy{}
			priorEdits := engine.LoadSnapshotEdits(snapRec)

			// The regeneration is presented as deltas on the text the user was
			// looking at: the candidate draft with accepted edits inlined and
			// undecided proposals shown as their original passages. Only a
			// candidate that never had a draft falls back to the approved
			// output, and one with neither is replaced wholesale.
			prev := engine.ResolveDraftBaseline(snapRec.GetString("output_draft"), priorEdits)
			if strings.TrimSpace(prev) == "" {
				if snaps, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(), "projection_id = {:pid} && status = {:status}", "-approval_sequence_number", 1, 0, dbx.Params{"pid": projID, "status": engine.StatusApproved}); err == nil && len(snaps) > 0 {
					prev = snaps[0].GetString("output")
				}
			}

			var newDraft string
			var newEdits []api.SnapshotEdit
			if strings.TrimSpace(prev) != "" {
				newDraft, newEdits = engine.DiffAndMarkBlocks(prev, output, api.EditTypeRegeneration)
			} else {
				newDraft = output
				newEdits = []api.SnapshotEdit{}
			}

			// Prior edits are superseded by the regeneration, except an accepted
			// edit whose passage the regenerated text still carries verbatim:
			// that one stands, re-anchored to where the passage now sits.
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
				e.UndoReason = "regenerated"
				e.Undoable = &undoableFalse
				e.UpdatedAt = now
			}

			for i := range newEdits {
				newEdits[i].Sequence = maxSeq + 1 + i
			}

			combinedEdits := append(priorEdits, newEdits...)

			if lensCol, err := app.FindCollectionByNameOrId(strat.LensCollectionName()); err == nil {
				lensRec := core.NewRecord(lensCol)
				lensRec.Set("prompt", lens)
				lensRec.Set(strat.RefinementForeignKeyCol(), refRec.Id)
				if err := app.Save(lensRec); err == nil {
					snapRec.Set("lens_id", lensRec.Id)
				}
			}

			snapRec.Set("output_draft", newDraft)
			snapRec.Set("output_raw", output)
			snapRec.Set("edits", pbutil.JSONObject(combinedEdits))
			snapRec.Set("context_spec", pbutil.JSONObject(spec))
			snapRec.Set("resolved_context", pbutil.JSONObject(pinned))
			snapRec.Set("generated_by_model", model)
			if err := app.Save(snapRec); err != nil {
				logger().Error("failed to save candidate snapshot", "error", err, "snapshot_id", snapID)
				return "", err
			}

			if len(supersededSeqs) > 0 || len(keptSeqs) > 0 {
				noticeText := prompts.RegenerateSupersededNotice(supersededSeqs, keptSeqs)
				noticeData, _ := json.Marshal(prompts.RegenerateSupersededData{
					Sequences: supersededSeqs,
					Kept:      keptSeqs,
				})
				msg := api.UIMessage{
					ID:   fmt.Sprintf("superseded-regen-%d", time.Now().UnixNano()),
					Role: "system",
					Parts: []api.UIMessagePart{
						{
							Type: prompts.RegenerateSupersededPartType,
							Text: noticeText,
							Data: noticeData,
						},
					},
				}
				_, _ = chat.PersistMessage(ctx, app, refRec, msg, "")
			}
		}
		return snapID, nil
	}

	var newSnapID string
	err := app.RunInTransaction(func(tx core.App) error {
		parentRec, err := tx.FindRecordById(schema.ColProjection.String(), projID)
		if err != nil {
			return err
		}

		strat := projections.Strategy{}
		lensCol, err := tx.FindCollectionByNameOrId(strat.LensCollectionName())
		if err != nil {
			return err
		}
		lensRec := core.NewRecord(lensCol)
		lensRec.Set("prompt", lens)
		lensRec.Set(strat.RefinementForeignKeyCol(), refRec.Id)
		if err := tx.Save(lensRec); err != nil {
			return err
		}

		sID, err := engine.AppendSnapshot(ctx, tx, strat, engine.SnapshotSpec{
			SourceID:                parentRec.Id,
			LensID:                  lensRec.Id,
			Output:                  "",
			OutputDraft:             output,
			OutputRaw:               output,
			ContextSpec:             spec,
			ResolvedContext:         pinned,
			Status:                  engine.StatusPending,
			Model:                   model,
			CreatedFromRefinementID: refRec.Id,
		})
		if err != nil {
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
	if err != nil {
		logger().Error("failed to materialize candidate from refinement", "error", err, "projection_id", projID)
		return "", err
	}
	return newSnapID, nil
}
