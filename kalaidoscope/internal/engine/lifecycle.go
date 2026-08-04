package engine

import (
	"context"
	"log"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	StatusPending  = "pending"
	StatusApproved = "approved"
)

type SnapshotSpec struct {
	SourceID        string
	LensID          string
	Output          string
	ContextSpec     api.ContextSpec
	ResolvedContext llmcontext.PinnedIDs
	WindowSpec      any // optional
	ResolvedWindow  any // optional
	Status          string

	Model string
}

func AppendSnapshot(ctx context.Context, app core.App, collectionName string, foreignKeyCol string, s SnapshotSpec) (string, error) {
	sCol, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return "", err
	}
	snap := core.NewRecord(sCol)
	snap.Set(foreignKeyCol, s.SourceID)
	snap.Set("lens_id", s.LensID)
	snap.Set("output", pbutil.JSONString(s.Output))
	snap.Set("context_spec", pbutil.JSONObject(s.ContextSpec))
	snap.Set("resolved_context", pbutil.JSONObject(s.ResolvedContext))

	if collectionName == "reflection_snapshot" {
		if s.WindowSpec != nil {
			snap.Set("window_spec", pbutil.JSONObject(s.WindowSpec))
		}
		if s.ResolvedWindow != nil {
			snap.Set("resolved_window", pbutil.JSONObject(s.ResolvedWindow))
		}
	}

	status := s.Status
	if status == "" {
		status = StatusApproved
	}
	snap.Set("status", status)
	snap.Set("model", s.Model)

	if err := app.Save(snap); err != nil {
		return "", err
	}
	return snap.Id, nil
}

func refinementModel() string {
	model, err := llm.ResolveRole(llm.RoleRefinement)
	if err != nil {
		return ""
	}
	return model
}

func ApproveSnapshot(ctx context.Context, app core.App, strat Strategy, snapshotID string) error {
	snap, err := app.FindRecordById(strat.SnapshotCollectionName(), snapshotID)
	if err != nil {
		return err
	}
	snap.Set("status", StatusApproved)
	return app.Save(snap)
}

func CommitRefinement(ctx context.Context, app core.App, strat Strategy, parentID, sourceSnapshotID string, output string, updateLensAndContext bool, pinned llmcontext.PinnedIDs, spec api.ContextSpec, winSpec api.WindowSpec, refinementID, targetCol string) (string, error) {
	oldLensID := ""
	if sourceSnapshotID != "" {
		if sourceSnap, err := app.FindRecordById(strat.SnapshotCollectionName(), sourceSnapshotID); err == nil {
			oldLensID = sourceSnap.GetString("lens_id")
		}
	}

	snapLensID := oldLensID
	if updateLensAndContext {
		snapLensID = ""
	}

	newSnapID, err := AppendSnapshot(ctx, app, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), SnapshotSpec{
		SourceID:        parentID,
		LensID:          snapLensID,
		Output:          output,
		ContextSpec:     spec,
		ResolvedContext: pinned,
		WindowSpec:      winSpec,
		Status:          StatusApproved,

		Model: refinementModel(),
	})
	if err != nil {
		return "", err
	}

	if updateLensAndContext {
		if parentRec, err := app.FindRecordById(targetCol, parentID); err == nil {
			parentRec.Set("current_context_spec", pbutil.JSONObject(spec))
			if targetCol == "reflection" {
				parentRec.Set("current_window_spec", pbutil.JSONObject(winSpec))
			}
			_ = app.Save(parentRec)
		}

		// TODO: execute this asynchronously so that the LLM generation doesn't block the API
		// request or the UI. (Note: ensure that context is correctly handled if moved to a goroutine)
		if err := DistillAndUpdateLens(ctx, app, strat, newSnapID, oldLensID, spec, refinementID, targetCol); err != nil {
			log.Printf("refinement lens distillation failed: %v", err)
			return "", err
		}
	}

	return newSnapID, nil
}
