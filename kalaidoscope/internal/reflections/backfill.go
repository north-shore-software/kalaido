package reflections

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// ErrBackfillOutOfRange rejects a backfill that starts at or after the point
// the grid already covers.
var ErrBackfillOutOfRange = errors.New("backfill start must be before the windows already on the grid")

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "reflections")
	}
	return slog.Default().With("component", "reflections")
}

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

	col, err := app.FindCollectionByNameOrId(schema.ColReflectionWindow.String())
	if err != nil {
		return nil, err
	}
	for _, w := range windows {
		row := core.NewRecord(col)
		row.Set("reflection_id", rec.Id)
		engine.SetSnapshotWindow(row, &w)
		if err := app.Save(row); err != nil {
			// Already materialized: the unique index says so.
			start, end := engine.WindowBounds(&w)
			existing, _ := app.FindFirstRecordByFilter(schema.ColReflectionWindow.String(),
				"reflection_id = {:id} && window_start = {:ws} && window_end = {:we}",
				map[string]any{"id": rec.Id, "ws": start.String(), "we": end.String()})
			if existing == nil {
				return nil, fmt.Errorf("materialize window %s: %w", WindowKey(w), err)
			}
		}
	}
	return windows, nil
}

// RunPendingWindows generates, in the background and at background priority,
// every window the reflection currently owes (PendingWindows). One pass: a
// window whose generation fails stays pending for the next run rather than
// being retried in a loop. The DB is the state — a restart mid-run loses
// nothing but the goroutines.
func RunPendingWindows(r workerutil.Runner, app core.App, reflectionID string) {
	r.Go(func(ctx context.Context) { GeneratePendingWindows(ctx, app, reflectionID) })
}

// GeneratePendingWindows is RunPendingWindows's body, run to completion on
// the calling goroutine.
func GeneratePendingWindows(ctx context.Context, app core.App, reflectionID string) {
	rec, err := app.FindRecordById(schema.ColReflection.String(), reflectionID)
	if err != nil {
		logger(app).Error("backfill: load reflection failed", "reflection_id", reflectionID, "error", err)
		return
	}
	pending := PendingWindows(app, rec, time.Now())
	if len(pending) == 0 {
		return
	}
	logger(app).Info("backfill pending windows", "reflection_id", reflectionID, "name", rec.GetString("name"), "count", len(pending))

	ctx = queue.WithPriority(ctx, queue.Background)
	results := GenerateWindows(ctx, app, reflectionID, engine.StatusApproved, pending)
	generated := 0
	for i, r := range results {
		switch {
		case r.Err == nil:
			generated++
		case errors.Is(r.Err, engine.ErrLensNotReady):
			logger(app).Warn("backfill: no lens yet", "reflection_id", reflectionID)
		case errors.Is(r.Err, engine.ErrGenerationInFlight):
			// Someone else is producing this window; leave it to them.
		default:
			logger(app).Error("backfill window failed", "reflection_id", reflectionID, "window", WindowKey(pending[i]), "error", r.Err)
		}
	}
	logger(app).Info("backfill completed", "reflection_id", reflectionID, "generated", generated, "count", len(pending))
}
