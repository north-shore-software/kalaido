// UNREVIEWED
package engine

import (
	"context"
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
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
	// ErrGenerationAbandoned: the generation being awaited ended without
	// output — its claim row was released (failure) or nothing was running.
	ErrGenerationAbandoned = errors.New("generation ended without output")
)

// awaitPollInterval is the fallback pace at which AwaitGeneration re-reads a
// claim row it has not been told about. The generating goroutine in this
// process wakes waiters the moment it settles the claim (claimHub), so the
// poll only matters for a claim settled some other way. A variable so tests
// can shorten it.
var awaitPollInterval = 500 * time.Millisecond

// AwaitGeneration joins a generation another caller (typically the wave) is
// running for the target: it waits for the live claim row to be filled and
// returns the resulting snapshot id. The row is the same durable state the
// UI reads; the in-process hub only says when to look. Returns
// ErrGenerationAbandoned when there is no live claim or it is released
// unfilled, and ctx's error when the wait is cancelled; a superseded row
// (discarded while awaited) reads as abandoned too.
func AwaitGeneration(ctx context.Context, app core.App, strat Strategy, parentID string, window *api.Window) (string, error) {
	filter, params := statusSnapshotFilter(strat, parentID, window, StatusGenerating)
	live, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "-created", 1, 0, params)
	if err != nil {
		return "", err
	}
	if len(live) == 0 {
		return "", ErrGenerationAbandoned
	}
	claimID := live[0].Id
	settled := claims.subscribe(claimID)
	defer claims.unsubscribe(claimID, settled)
	ticker := time.NewTicker(awaitPollInterval)
	defer ticker.Stop()
	for {
		// Read first: a claim settled between the lookup above and the
		// subscribe has no waiter to wake, and must not cost a poll interval.
		rec, err := app.FindRecordById(strat.SnapshotCollectionName(), claimID)
		if err != nil {
			// Released: the generation failed, or a settle-in-place found
			// nothing to publish.
			return "", ErrGenerationAbandoned
		}
		switch rec.GetString("status") {
		case StatusGenerating:
		case StatusDiscarded:
			return "", ErrGenerationAbandoned
		default:
			return rec.Id, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-settled:
			// A closed channel is always ready; disable the case so a row
			// that still reads as generating falls back to the poll rather
			// than spinning.
			settled = nil
		case <-ticker.C:
		}
	}
}

// A claim older than this belongs to a run that crashed or hung; a new
// generation takes it over instead of blocking forever.
const GenerationClaimTTL = 10 * time.Minute

// claimGeneration takes the per-target generation lock by inserting the
// status='generating' claim row. PocketBase funnels writes through a single
// non-concurrent SQLite connection, so the check-then-insert inside one
// transaction cannot race a concurrent claim.
func claimGeneration(app core.App, strat Strategy, parentID string, window *api.Window) (string, error) {
	var claimID string
	err := app.RunInTransaction(func(tx core.App) error {
		filter, params := statusSnapshotFilter(strat, parentID, window, StatusGenerating)
		claims, err := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "", 0, 0, params)
		if err != nil {
			return err
		}
		for _, c := range claims {
			if time.Since(c.GetDateTime("created").Time()) < GenerationClaimTTL {
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
			setSnapshotWindow(claim, window)
		}
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
		logger().Error("generation claim release failed", "claim_id", claimID, "error", err)
		return
	}
	claims.settle(claimID)
}

// discardOtherPending supersedes every other pending candidate for the same
// parent (and window), leaving exceptID as the single reviewable one.
func discardOtherPending(tx core.App, strat Strategy, parentID string, window *api.Window, exceptID string) error {
	filter, params := statusSnapshotFilter(strat, parentID, window, StatusPending)
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
				logger().Error("generation claim sweep delete failed", "target_type", strat.TargetType(), "claim_id", r.Id, "error", err)
			}
		}
	}
}
