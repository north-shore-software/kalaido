package engine

import (
	"errors"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	// StatusGenerating marks a claim row: a snapshot record inserted at the
	// start of a generation that serializes work per target (and per window for
	// reflections). The row is the lock — the same durable state the UI reads —
	// so mutual exclusion and the "Generating…" display can never disagree. On
	// success the claim is filled in place and becomes the pending/approved
	// snapshot; on failure it is deleted.
	StatusGenerating = "generating"
	// StatusDiscarded marks a superseded pending candidate. Approving a
	// candidate, or generating a fresh one, discards its pending siblings so at
	// most one reviewable candidate exists per target.
	StatusDiscarded = "discarded"
)

var (
	// ErrLensNotReady: the target has no lens — it has never had a refinement
	// committed (a commit installs the drafted lens atomically). Generation is
	// refused rather than persisting an empty document as a reviewable
	// candidate.
	ErrLensNotReady = errors.New("lens not ready")
	// ErrGenerationInFlight: a live claim row already exists for this target.
	ErrGenerationInFlight = errors.New("generation already running")
	// ErrNotApprovable: the candidate must not become the plan of record
	// (empty output, still generating, or already superseded).
	ErrNotApprovable = errors.New("candidate cannot be approved")
)

// A claim older than this belongs to a run that crashed or hung; a new
// generation takes it over instead of blocking forever.
const generationClaimTTL = 10 * time.Minute

// claimGeneration takes the per-target generation lock by inserting the
// status='generating' claim row. PocketBase funnels writes through a single
// non-concurrent SQLite connection, so the check-then-insert inside one
// transaction cannot race a concurrent claim.
func claimGeneration(app core.App, strat Strategy, parentID, windowKey string) (string, error) {
	var claimID string
	err := app.RunInTransaction(func(tx core.App) error {
		filter, params := statusSnapshotFilter(strat, parentID, windowKey, StatusGenerating)
		claims, err := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "", 0, 0, params)
		if err != nil {
			return err
		}
		for _, c := range claims {
			if time.Since(c.GetDateTime("generation_timestamp").Time()) < generationClaimTTL {
				return ErrGenerationInFlight
			}
			if err := tx.Delete(c); err != nil {
				return err
			}
		}
		col, err := tx.FindCollectionByNameOrId(strat.SnapshotCollectionName())
		if err != nil {
			return err
		}
		claim := core.NewRecord(col)
		claim.Set(strat.ForeignKeyCol(), parentID)
		claim.Set("status", StatusGenerating)
		if strat.TargetType() == "reflection" {
			claim.Set("window_key", windowKey)
		}
		claim.Set("generation_timestamp", types.NowDateTime())
		if err := tx.Save(claim); err != nil {
			return err
		}
		claimID = claim.Id
		return nil
	})
	if err != nil {
		return "", err
	}
	return claimID, nil
}

// releaseClaim deletes an unfilled claim row after a failed generation. A row
// that already advanced past StatusGenerating is left alone.
func releaseClaim(app core.App, strat Strategy, claimID string) {
	rec, err := app.FindRecordById(strat.SnapshotCollectionName(), claimID)
	if err != nil {
		return
	}
	if rec.GetString("status") != StatusGenerating {
		return
	}
	if err := app.Delete(rec); err != nil {
		log.Printf("generation claim %s: release: %v", claimID, err)
	}
}

// discardOtherPending supersedes every other pending candidate for the same
// parent (and window), leaving exceptID as the single reviewable one.
func discardOtherPending(tx core.App, strat Strategy, parentID, windowKey, exceptID string) error {
	filter, params := statusSnapshotFilter(strat, parentID, windowKey, StatusPending)
	filter += " && id != {:except}"
	params["except"] = exceptID
	recs, err := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "", 0, 0, params)
	if err != nil {
		return err
	}
	for _, r := range recs {
		r.Set("status", StatusDiscarded)
		if err := tx.Save(r); err != nil {
			return err
		}
	}
	return nil
}

// SweepGenerationClaims deletes every leftover claim row at startup — a claim
// can only be live while its generation goroutine runs in this process, so
// anything found at boot belongs to a crashed run.
func SweepGenerationClaims(app core.App) {
	for _, strat := range []Strategy{ProjectionStrategy{}, ReflectionStrategy{}} {
		recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
			"status = {:status}", "", 0, 0, map[string]any{"status": StatusGenerating})
		if err != nil {
			continue
		}
		for _, r := range recs {
			if err := app.Delete(r); err != nil {
				log.Printf("generation claim sweep: %s %s: %v", strat.TargetType(), r.Id, err)
			}
		}
	}
}
