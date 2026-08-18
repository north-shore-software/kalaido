package engine

import (
	"context"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const (
	StatusPending  = "pending"
	StatusApproved = "approved"
)

// RequestWave, when set, asks the reconcile worker for a speculative
// generation wave over the stale set. It is a hook variable rather than an
// import because the worker's package sits above engine (it needs the status
// evaluator, which itself imports engine). Wired by reconcile.Register.
var RequestWave func()

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

	// Non-empty marks a snapshot as part of a speculative chain (see
	// llmcontext.ChainOriginGenerateAll). Left empty, AppendSnapshot falls back
	// to the origin marked on ctx, so wave generations need no plumbing.
	ChainOrigin string

	// Set on refinement commits. LensDistillRequested is the durable marker the
	// background distillation worker derives its worklist from (together with an
	// empty LensID), so the commit needs no in-memory handoff to survive.
	CreatedFromRefinementID string
	LensDistillRequested    bool

	WindowKey               string
	WindowSpecVersionNumber int
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
			snap.Set("window_key", s.WindowKey)
		}
		snap.Set("window_spec_version_number", s.WindowSpecVersionNumber)
	}

	status := s.Status
	if status == "" {
		status = StatusApproved
	}
	snap.Set("status", status)
	snap.Set("model", s.Model)
	snap.Set("created_from_refinement_id", s.CreatedFromRefinementID)
	snap.Set("lens_distill_requested", s.LensDistillRequested)
	origin := s.ChainOrigin
	if origin == "" {
		origin = llmcontext.ChainOriginFromContext(ctx)
	}
	snap.Set("chain_origin", origin)
	snap.Set("generation_timestamp", types.NowDateTime())

	if err := app.Save(snap); err != nil {
		return "", err
	}
	return snap.Id, nil
}

func ApproveSnapshot(ctx context.Context, app core.App, strat Strategy, snapshotID string) error {
	return app.RunInTransaction(func(txApp core.App) error {
		snap, err := txApp.FindRecordById(strat.SnapshotCollectionName(), snapshotID)
		if err != nil {
			return err
		}
		if snap.GetInt("approval_sequence_number") > 0 {
			return nil
		}
		seq, err := nextApprovalSequence(txApp, strat, snap)
		if err != nil {
			return err
		}
		snap.Set("approval_sequence_number", seq)
		snap.Set("approval_timestamp", types.NowDateTime())
		snap.Set("status", StatusApproved)
		return txApp.Save(snap)
	})
}

func nextApprovalSequence(app core.App, strat Strategy, snap *core.Record) (int, error) {
	filter := strat.ForeignKeyCol() + " = {:parent} && status = 'approved'"
	params := dbx.Params{"parent": snap.GetString(strat.ForeignKeyCol())}
	if strat.TargetType() == "reflection" {
		if wk := snap.GetString("window_key"); wk == "" {
			// A bound empty param compares `= ''` in SQL and misses rows whose
			// window_key was never written (NULL); PocketBase's literal ''
			// matches empty-or-null. Without this, every windowless snapshot
			// sequences from 1 and the second approval hits the unique index.
			filter += " && window_key = ''"
		} else {
			filter += " && window_key = {:wk}"
			params["wk"] = wk
		}
	}
	recs, err := app.FindRecordsByFilter(
		strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params)
	if err != nil {
		return 0, err
	}
	if len(recs) == 0 {
		return 1, nil
	}
	return recs[0].GetInt("approval_sequence_number") + 1, nil
}

func CommitRefinement(ctx context.Context, app core.App, strat Strategy, parentID, sourceSnapshotID string, output string, updateLensAndContext bool, pinned llmcontext.PinnedIDs, spec api.ContextSpec, winSpec api.WindowSpec, refinementID, targetCol string) (string, error) {
	oldLensID := ""
	chainOrigin := ""
	var resWin any
	var winKey string
	var specVersionNumber int
	if sourceSnapshotID != "" {
		if sourceSnap, err := app.FindRecordById(strat.SnapshotCollectionName(), sourceSnapshotID); err == nil {
			oldLensID = sourceSnap.GetString("lens_id")
			// Only a still-pending chain candidate carries its mark forward: the
			// user is mid click-through and edited instead of approving as-is.
			// A refinement of an already-approved snapshot is an ordinary edit,
			// even if that snapshot was chain-generated once — it must not start
			// background work on its own.
			if sourceSnap.GetString("status") == StatusPending {
				chainOrigin = sourceSnap.GetString("chain_origin")
			}
			if strat.TargetType() == "reflection" {
				var rw map[string]string
				if err := sourceSnap.UnmarshalJSONField("resolved_window", &rw); err == nil && len(rw) > 0 {
					resWin = rw
					winKey = sourceSnap.GetString("window_key")
					specVersionNumber = sourceSnap.GetInt("window_spec_version_number")
				}
			}
		}
	}

	snapLensID := oldLensID
	if updateLensAndContext {
		snapLensID = ""
	}

	// Best-effort provenance, matching the previous silent-empty behavior: a
	// refinement follows its parent entity's effective model.
	parentRec, parentErr := app.FindRecordById(targetCol, parentID)
	model := ""
	if parentErr == nil {
		model, _ = llm.ResolveRoleFor(llm.RoleRefinement, parentRec.GetString("model"))
	}

	newSnapID, err := AppendSnapshot(ctx, app, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), SnapshotSpec{
		SourceID:        parentID,
		LensID:          snapLensID,
		Output:          output,
		ContextSpec:     spec,
		ResolvedContext: pinned,
		WindowSpec:      winSpec,
		ResolvedWindow:  resWin,
		Status:          StatusApproved,

		Model:                   model,
		ChainOrigin:             chainOrigin,
		WindowKey:               winKey,
		WindowSpecVersionNumber: specVersionNumber,

		CreatedFromRefinementID: refinementID,
		LensDistillRequested:    updateLensAndContext,
	})
	if err != nil {
		return "", err
	}

	if err := ApproveSnapshot(ctx, app, strat, newSnapID); err != nil {
		return "", err
	}

	if updateLensAndContext {
		if parentErr == nil {
			parentRec.Set("current_context_spec", pbutil.JSONObject(spec))
			_ = app.Save(parentRec)
		}

		RequestLensDistill()
	}

	// An edit to a chain-marked candidate has just superseded whatever its
	// pre-generated dependents consumed. Re-run the wave so the downstream
	// subtree regenerates; its dedup guard leaves untouched branches alone.
	if chainOrigin != "" && RequestWave != nil {
		RequestWave()
	}

	return newSnapID, nil
}
