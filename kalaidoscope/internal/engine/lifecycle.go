package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const (
	StatusPending  = "pending_review"
	StatusApproved = "approved"

	EntityProposed = "proposed"
	EntityActive   = "active"
)

type SnapshotSpec struct {
	SourceID        string
	LensID          string
	Output          string
	OutputRaw       string
	OutputDraft     string
	Edits           []api.SnapshotEdit
	ContextSpec     api.ContextSpec
	ResolvedContext llmcontext.PinnedIDs
	// Reflections: the window this snapshot covers; nil for a windowless
	// (unscheduled) reflection. Ignored for projections.
	Window *api.Window
	Status string

	Model string

	// Set on refinement commits.
	CreatedFromRefinementID string
}

func AppendSnapshot(ctx context.Context, app core.App, strat Strategy, s SnapshotSpec) (string, error) {
	sCol, err := app.FindCollectionByNameOrId(strat.SnapshotCollectionName())
	if err != nil {
		return "", err
	}
	snap := core.NewRecord(sCol)
	applySnapshotSpec(snap, strat, s)
	if err := app.Save(snap); err != nil {
		return "", err
	}
	return snap.Id, nil
}

// applySnapshotSpec stamps a SnapshotSpec onto a record — a fresh one
// (AppendSnapshot) or the generation claim row being filled in place
// (completeClaimedSnapshot).
func applySnapshotSpec(snap *core.Record, strat Strategy, s SnapshotSpec) {
	snap.Set(strat.ForeignKeyCol(), s.SourceID)
	snap.Set("lens_id", s.LensID)
	snap.Set("output", s.Output)
	snap.Set("output_raw", s.OutputRaw)
	snap.Set("output_draft", s.OutputDraft)
	if s.Edits != nil {
		snap.Set("edits", pbutil.JSONObject(s.Edits))
	} else if snap.Get("edits") == nil {
		snap.Set("edits", pbutil.JSONObject([]api.SnapshotEdit{}))
	}
	snap.Set("context_spec", pbutil.JSONObject(s.ContextSpec))
	snap.Set("resolved_context", pbutil.JSONObject(s.ResolvedContext))

	strat.ApplySnapshotWindow(snap, s.Window)

	status := s.Status
	if status == "" {
		status = StatusApproved
	}
	snap.Set("status", status)
	snap.Set("generated_by_model", s.Model)
	snap.Set("created_from_refinement_id", s.CreatedFromRefinementID)
	snap.Set("generated_at", types.NowDateTime())
}

func LoadSnapshotEdits(rec *core.Record) []api.SnapshotEdit {
	var edits []api.SnapshotEdit
	_ = rec.UnmarshalJSONField("edits", &edits)
	return edits
}

// CompleteClaimedSnapshot fills the generation claim row with the finished
// output, in the same transaction discarding any pending siblings so at most
// one reviewable candidate exists per target (and window).
func CompleteClaimedSnapshot(ctx context.Context, app core.App, strat Strategy, claimID string, s SnapshotSpec) error {
	return completeClaimedSnapshot(ctx, app, strat, claimID, s)
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
		applySnapshotSpec(snap, strat, s)
		if err := tx.Save(snap); err != nil {
			return err
		}
		return discardOtherPending(tx, strat, s.SourceID, s.Window, snap.Id)
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
		if strings.TrimSpace(snap.GetString("output")) == "" {
			draft := snap.GetString("output_draft")
			if HasUnresolvedEditMarkers(draft) {
				return fmt.Errorf("%w: candidate has unresolved edits", ErrNotApprovable)
			}
			snap.Set("output", strings.TrimSpace(draft))
		}
		if strings.TrimSpace(snap.GetString("output")) == "" {
			return fmt.Errorf("%w: candidate has no content", ErrNotApprovable)
		}
		seq, err := nextApprovalSequence(txApp, strat, snap)
		if err != nil {
			return err
		}
		snap.Set("approval_sequence_number", seq)
		snap.Set("approved_at", types.NowDateTime())
		snap.Set("status", StatusApproved)
		if err := txApp.Save(snap); err != nil {
			return err
		}
		approvedSeq = seq
		parentID = snap.GetString(strat.ForeignKeyCol())
		return discardOtherPending(txApp, strat, parentID, SnapshotWindow(snap), snap.Id)
	})
	if err == nil && approvedSeq > 0 {
		logger().Info("snapshot approved",
			"target_type", strat.TargetType(), "id", parentID, "snapshot_id", snapshotID, "sequence", approvedSeq)
	}
	return err
}

// ApprovedSnapshotFilter selects a parent's approved snapshots, scoped for
// reflections to one window (nil = the windowless chain) — each window
// carries its own approval chain.
func ApprovedSnapshotFilter(strat Strategy, parentID string, window *api.Window) (string, dbx.Params) {
	return statusSnapshotFilter(strat, parentID, window, StatusApproved)
}

// statusSnapshotFilter selects a parent's snapshots of one status, with the
// same reflection window scoping as ApprovedSnapshotFilter.
func statusSnapshotFilter(strat Strategy, parentID string, window *api.Window, status string) (string, dbx.Params) {
	filter := strat.ForeignKeyCol() + " = {:parent} && status = {:status}"
	params := dbx.Params{"parent": parentID, "status": status}
	clause, wParams := strat.SnapshotWindowFilter(window)
	filter += clause
	for k, v := range wParams {
		params[k] = v
	}
	return filter, params
}

func nextApprovalSequence(app core.App, strat Strategy, snap *core.Record) (int, error) {
	filter, params := ApprovedSnapshotFilter(strat, snap.GetString(strat.ForeignKeyCol()), SnapshotWindow(snap))
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

// RemoveID is ids without id, in place.
func RemoveID(ids []string, id string) []string {
	kept := ids[:0]
	for _, x := range ids {
		if x != id {
			kept = append(kept, x)
		}
	}
	return kept
}

// ScrubContextSpecs applies scrub to every live current_context_spec in the
// projection and reflection collections that mentions id, saving the ones it
// changed, so a deleted colour or a soft-deleted upstream entity leaves no
// dangling reference behind. A Strategy's ScrubSpec is the scrub for its
// entity type.
func ScrubContextSpecs(app core.App, id string, scrub func(spec *api.ContextSpec, id string)) error {
	for _, collection := range []string{schema.ColProjection.String(), schema.ColReflection.String()} {
		recs, err := app.FindRecordsByFilter(collection, "current_context_spec ~ {:id}", "", 0, 0, dbx.Params{"id": id})
		if err != nil {
			return err
		}
		for _, rec := range recs {
			var spec api.ContextSpec
			if err := rec.UnmarshalJSONField("current_context_spec", &spec); err != nil {
				continue
			}
			before := len(spec.ColourIDs) + len(spec.SourceProjectionIDs) + len(spec.SourceReflectionIDs)
			scrub(&spec, id)
			if len(spec.ColourIDs)+len(spec.SourceProjectionIDs)+len(spec.SourceReflectionIDs) == before {
				continue
			}
			rec.Set("current_context_spec", pbutil.JSONObject(spec))
			if err := app.Save(rec); err != nil {
				return err
			}
		}
	}
	return nil
}
