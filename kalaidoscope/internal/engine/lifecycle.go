package engine

import (
	"context"
	"fmt"
	"log"
	"strings"

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

	EntityProposed = "proposed"
	EntityActive   = "active"
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

	// Set on refinement commits.
	CreatedFromRefinementID string

	WindowKey               string
	WindowSpecVersionNumber int
}

func AppendSnapshot(ctx context.Context, app core.App, collectionName string, foreignKeyCol string, s SnapshotSpec) (string, error) {
	sCol, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return "", err
	}
	snap := core.NewRecord(sCol)
	applySnapshotSpec(ctx, snap, collectionName, foreignKeyCol, s)
	if err := app.Save(snap); err != nil {
		return "", err
	}
	return snap.Id, nil
}

// applySnapshotSpec stamps a SnapshotSpec onto a record — a fresh one
// (AppendSnapshot) or the generation claim row being filled in place
// (completeClaimedSnapshot).
func applySnapshotSpec(ctx context.Context, snap *core.Record, collectionName string, foreignKeyCol string, s SnapshotSpec) {
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
	origin := s.ChainOrigin
	if origin == "" {
		origin = llmcontext.ChainOriginFromContext(ctx)
	}
	snap.Set("chain_origin", origin)
	snap.Set("generation_timestamp", types.NowDateTime())
}

// completeClaimedSnapshot fills the generation claim row with the finished
// output, in the same transaction discarding any pending siblings so at most
// one reviewable candidate exists per target (and window).
func completeClaimedSnapshot(ctx context.Context, app core.App, strat Strategy, claimID string, s SnapshotSpec) error {
	return app.RunInTransaction(func(tx core.App) error {
		snap, err := tx.FindRecordById(strat.SnapshotCollectionName(), claimID)
		if err != nil {
			return err
		}
		applySnapshotSpec(ctx, snap, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), s)
		if err := tx.Save(snap); err != nil {
			return err
		}
		return discardOtherPending(tx, strat, s.SourceID, s.WindowKey, snap.Id)
	})
}

func ApproveSnapshot(ctx context.Context, app core.App, strat Strategy, snapshotID string) error {
	var approvedSeq int
	var parentID string
	err := app.RunInTransaction(func(txApp core.App) error {
		snap, err := txApp.FindRecordById(strat.SnapshotCollectionName(), snapshotID)
		if err != nil {
			return err
		}
		if snap.GetInt("approval_sequence_number") > 0 {
			return nil
		}
		// Circuit breaker: never promote a candidate that was never actually
		// generated (empty output), is still generating (a claim row), or was
		// already superseded. An empty snapshot as the plan of record poisons
		// staleness counts and gives downstream consumers "" as approved truth.
		switch snap.GetString("status") {
		case StatusGenerating:
			return fmt.Errorf("%w: generation still running", ErrNotApprovable)
		case StatusDiscarded:
			return fmt.Errorf("%w: candidate was superseded", ErrNotApprovable)
		}
		if strings.TrimSpace(pbutil.DecodeJSONString(snap.GetString("output"))) == "" {
			return fmt.Errorf("%w: candidate has no content", ErrNotApprovable)
		}
		seq, err := nextApprovalSequence(txApp, strat, snap)
		if err != nil {
			return err
		}
		snap.Set("approval_sequence_number", seq)
		snap.Set("approval_timestamp", types.NowDateTime())
		snap.Set("status", StatusApproved)
		if err := txApp.Save(snap); err != nil {
			return err
		}
		approvedSeq = seq
		parentID = snap.GetString(strat.ForeignKeyCol())
		return discardOtherPending(txApp, strat,
			parentID, snap.GetString("window_key"), snap.Id)
	})
	if err == nil && approvedSeq > 0 {
		log.Printf("approve %s %s: snapshot %s is now the approved output (sequence %d)",
			strat.TargetType(), parentID, snapshotID, approvedSeq)
	}
	return err
}

// ApprovedSnapshotFilter selects a parent's approved snapshots, scoped for
// reflections to one window — each window key carries its own approval chain.
func ApprovedSnapshotFilter(strat Strategy, parentID, windowKey string) (string, dbx.Params) {
	return statusSnapshotFilter(strat, parentID, windowKey, StatusApproved)
}

// statusSnapshotFilter selects a parent's snapshots of one status, with the
// same reflection window scoping as approvedSnapshotFilter.
func statusSnapshotFilter(strat Strategy, parentID, windowKey, status string) (string, dbx.Params) {
	filter := strat.ForeignKeyCol() + " = {:parent} && status = {:status}"
	params := dbx.Params{"parent": parentID, "status": status}
	if strat.TargetType() == "reflection" {
		if windowKey == "" {
			// A bound empty param compares `= ''` in SQL and misses rows whose
			// window_key was never written (NULL); PocketBase's literal ''
			// matches empty-or-null. Without this, every windowless snapshot
			// would live in its own chain: approvals would all sequence from 1
			// (and the second one hit the unique index), and the minimal-diff
			// rewrite would never find its predecessor.
			filter += " && window_key = ''"
		} else {
			filter += " && window_key = {:wk}"
			params["wk"] = windowKey
		}
	}
	return filter, params
}

func nextApprovalSequence(app core.App, strat Strategy, snap *core.Record) (int, error) {
	filter, params := ApprovedSnapshotFilter(strat, snap.GetString(strat.ForeignKeyCol()), snap.GetString("window_key"))
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

// CommitRefinement installs a refinement's drafted lens and its applied output
// as the entity's new plan of record, in one transaction: create the lens row,
// write the approved snapshot pointing at it, and re-point the parent's
// current_lens_id and current_context_spec. Because the lens exists the moment
// the commit lands, there is no window in which the entity is approved but
// lensless — a follow-up generation can never hit ErrLensNotReady from here.
//
// A reflection's lens is refined independently of its windows: the commit
// installs the lens and publishes nothing — the previewed window was a
// sample, and every window's existing snapshot now reads as produced by an
// older lens until it is regenerated (Refresh, or one window at a time). The
// returned snapshot id is therefore empty for reflections.
func CommitRefinement(ctx context.Context, app core.App, strat Strategy, parentID, sourceSnapshotID string, lensPrompt, output string, pinned llmcontext.PinnedIDs, spec api.ContextSpec, _ *api.Window, refinementID, targetCol string) (string, error) {
	var newSnapID string
	var chainOrigin string

	err := app.RunInTransaction(func(tx core.App) error {
		if sourceSnapshotID != "" && strat.TargetType() == "projection" {
			if sourceSnap, err := tx.FindRecordById(strat.SnapshotCollectionName(), sourceSnapshotID); err == nil {
				// Only a still-pending chain candidate carries its mark forward: the
				// user is mid click-through and edited instead of approving as-is.
				// A refinement of an already-approved snapshot is an ordinary edit,
				// even if that snapshot was chain-generated once — it must not start
				// background work on its own.
				if sourceSnap.GetString("status") == StatusPending {
					chainOrigin = sourceSnap.GetString("chain_origin")
				}
			}
		}

		// The parent is required now: the commit re-points its lens.
		parentRec, err := tx.FindRecordById(targetCol, parentID)
		if err != nil {
			return fmt.Errorf("parent %s %s: %w", targetCol, parentID, err)
		}

		lensCol, err := tx.FindCollectionByNameOrId(strat.LensCollectionName())
		if err != nil {
			return err
		}
		lensRec := core.NewRecord(lensCol)
		// Audit lineage only: nothing reads back through the chain.
		if oldLensID := parentRec.GetString("current_lens_id"); oldLensID != "" {
			lensRec.Set("parent_lens_id", oldLensID)
		}
		lensRec.Set("prompt", pbutil.JSONString(lensPrompt))
		lensRec.Set("context_spec", pbutil.JSONObject(spec))
		if strat.TargetType() == "reflection" {
			lensRec.Set("created_from_refl_refinement_id", refinementID)
		} else {
			lensRec.Set("created_from_proj_refinement_id", refinementID)
		}
		if err := tx.Save(lensRec); err != nil {
			return err
		}

		if strat.TargetType() == "projection" {
			// Provenance is the model that actually produced the output — the
			// per-turn apply resolves RoleSnapshot against the parent, exactly as a
			// future regeneration will, so SnapshotIsCurrent's model check stays
			// coherent.
			model, _ := llm.ResolveRoleFor(llm.RoleSnapshot, parentRec.GetString("model"))

			newSnapID, err = AppendSnapshot(ctx, tx, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), SnapshotSpec{
				SourceID:        parentID,
				LensID:          lensRec.Id,
				Output:          output,
				ContextSpec:     spec,
				ResolvedContext: pinned,
				Status:          StatusApproved,

				Model:       model,
				ChainOrigin: chainOrigin,

				CreatedFromRefinementID: refinementID,
			})
			if err != nil {
				return err
			}

			if err := ApproveSnapshot(ctx, tx, strat, newSnapID); err != nil {
				return err
			}
		}

		parentRec.Set("current_lens_id", lensRec.Id)
		parentRec.Set("current_context_spec", pbutil.JSONObject(spec))
		parentRec.Set("status", EntityActive)
		return tx.Save(parentRec)
	})
	if err != nil {
		return "", err
	}

	// An edit to a chain-marked candidate has just superseded whatever its
	// pre-generated dependents consumed. Re-run the wave so the downstream
	// subtree regenerates; its dedup guard leaves untouched branches alone.
	if chainOrigin != "" && RequestWave != nil {
		RequestWave()
	}

	return newSnapID, nil
}
