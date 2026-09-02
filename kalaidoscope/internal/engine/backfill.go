package engine

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
)

// ErrBackfillOutOfRange rejects a backfill that starts at or after the point
// the grid already covers.
var ErrBackfillOutOfRange = errors.New("backfill start must be before the windows already on the grid")

// MaterializeBackfill records every grid window between `from` and the point
// the governing version already covers (spec/model.md §Window Backfill),
// phase-aligned with the existing grid, and returns them oldest first.
// Materialisation is a row per window in reflection_window: permanent, and
// independent of whether generation later succeeds — a failed window stays
// pending and the next run picks it up. Re-running with the same range is a
// no-op (unique per reflection and window key).
func MaterializeBackfill(app core.App, rec *core.Record, from, now time.Time) ([]api.Window, error) {
	version, ok := GoverningVersion(LoadWindowSpecVersions(rec), now)
	if !ok || version.Spec.Period == "" {
		return nil, fmt.Errorf("reflection %s is not scheduled", rec.Id)
	}
	period := parseDurationOr(version.Spec.Period, 0)
	if period <= 0 {
		return nil, fmt.Errorf("reflection %s has no period", rec.Id)
	}
	covered := versionLowerBound(version)
	if !from.Before(covered) {
		return nil, ErrBackfillOutOfRange
	}

	// Extend the grid backwards by whole periods so the backfilled windows
	// line up with the ones the grid already produces.
	origin := parseRFC3339(version.Spec.StartTime)
	if origin.IsZero() {
		origin = covered
	}
	steps := int64(origin.Sub(from)/period) + 1
	shifted := version.Spec
	shifted.StartTime = origin.Add(-time.Duration(steps) * period).UTC().Format(time.RFC3339)

	windows := GridWindows(rec.Id, shifted, from, covered)
	if len(windows) == 0 {
		return nil, nil
	}

	col, err := app.FindCollectionByNameOrId("reflection_window")
	if err != nil {
		return nil, err
	}
	for _, w := range windows {
		row := core.NewRecord(col)
		row.Set("reflection_id", rec.Id)
		row.Set("window_key", WindowKey(w))
		row.Set("start", w.Start)
		row.Set("end", w.End)
		row.Set("window_spec_version_number", version.VersionNumber)
		if err := app.Save(row); err != nil {
			// Already materialized: the unique index says so.
			existing, _ := app.FindFirstRecordByFilter("reflection_window",
				"reflection_id = {:id} && window_key = {:k}",
				map[string]any{"id": rec.Id, "k": WindowKey(w)})
			if existing == nil {
				return nil, fmt.Errorf("materialize window %s: %w", WindowKey(w), err)
			}
		}
	}
	return windows, nil
}

// Background runs f off the caller's goroutine. A hook so tests can run it
// inline or not at all: a goroutine outliving a test's app would touch a
// closed database.
var Background = func(f func()) { go f() }

// RunPendingWindows generates, in the background and at background priority,
// every window the reflection currently owes (PendingWindows), oldest first.
// One pass: a window whose generation fails stays pending for the next run
// rather than being retried in a loop. The DB is the state — a restart
// mid-run loses nothing but the goroutine.
func RunPendingWindows(app core.App, reflectionID string) {
	Background(func() { GeneratePendingWindows(app, reflectionID) })
}

// GeneratePendingWindows is RunPendingWindows's body, run to completion on
// the calling goroutine.
func GeneratePendingWindows(app core.App, reflectionID string) {
	rec, err := app.FindRecordById("reflection", reflectionID)
	if err != nil {
		log.Printf("backfill %s: %v", reflectionID, err)
		return
	}
	pending := PendingWindows(app, rec, time.Now())
	if len(pending) == 0 {
		return
	}
	log.Printf("backfill %s (%q): %d pending windows", reflectionID, rec.GetString("name"), len(pending))

	ctx := llmq.WithPriority(context.Background(), llmq.Background)
	strat := ReflectionStrategy{}
	generated := 0
	for i := range pending {
		w := pending[i]
		for {
			_, err := GenerateSnapshot(ctx, app, reflectionID, StatusApproved, strat, &w)
			if errors.Is(err, llmq.ErrPreempted) {
				continue // interactive work took the slot; the retry waits for a free one
			}
			switch {
			case err == nil:
				generated++
			case errors.Is(err, ErrLensNotReady):
				log.Printf("backfill %s: no lens yet; stopping", reflectionID)
				return
			case errors.Is(err, ErrGenerationInFlight):
				// Someone else is producing this window; leave it to them.
			default:
				log.Printf("backfill %s: window %s: %v", reflectionID, WindowKey(w), err)
			}
			break
		}
	}
	log.Printf("backfill %s: generated %d of %d windows", reflectionID, generated, len(pending))
}
