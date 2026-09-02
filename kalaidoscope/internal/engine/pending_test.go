package engine

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func weeklyReflection(t *testing.T, app core.App, effective time.Time) *core.Record {
	t.Helper()
	versions := AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, effective)
	return testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": EntityActive,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
}

// Pending = materialized windows without an approved snapshot and without a
// generation in flight; approved and claimed windows drop out.
func TestPendingWindowsExcludesApprovedAndInFlight(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := t0
	now := t0.Add(16 * day) // two completed weeks
	refl := weeklyReflection(t, app, eff)

	grid := CurrentGridWindows(refl, now)
	if len(grid) != 2 {
		t.Fatalf("grid = %d windows, want 2", len(grid))
	}
	if got := PendingWindows(app, refl, now); len(got) != 2 {
		t.Fatalf("pending = %d, want both windows", len(got))
	}

	testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
		"reflection_id": refl.Id, "status": StatusApproved, "approval_sequence_number": 1,
		"output":          pbutil.JSONString("week one"),
		"window_key":      WindowKey(grid[0]),
		"resolved_window": pbutil.JSONObject(map[string]string{"start": grid[0].Start, "end": grid[0].End}),
	})
	got := PendingWindows(app, refl, now)
	if len(got) != 1 || got[0].ID != grid[1].ID {
		t.Fatalf("pending after approving week one = %+v, want only week two", got)
	}

	// A claim row (window_key only, no resolved_window yet) parks the window.
	testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
		"reflection_id": refl.Id, "status": StatusGenerating, "window_key": WindowKey(grid[1]),
	})
	if got := PendingWindows(app, refl, now); len(got) != 0 {
		t.Fatalf("pending with a claim open = %+v, want none", got)
	}
}

// A backfill materializes phase-aligned windows before the grid's own,
// permanently and idempotently; they are pending until generated.
func TestMaterializeBackfillAlignsWithGrid(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := t0
	now := t0.Add(10 * day) // one completed week on the grid
	refl := weeklyReflection(t, app, eff)

	from := eff.Add(-15 * day)
	windows, err := MaterializeBackfill(app, refl, from, now)
	if err != nil {
		t.Fatal(err)
	}
	// Grid points before eff, stepping back a week at a time: eff-14d, eff-7d, eff.
	assertWindows(t, windows, [][2]time.Time{
		{eff.Add(-21 * day), eff.Add(-14 * day)},
		{eff.Add(-14 * day), eff.Add(-7 * day)},
		{eff.Add(-7 * day), eff},
	})

	again, err := MaterializeBackfill(app, refl, from, now)
	if err != nil || len(again) != 3 {
		t.Fatalf("second backfill: %d windows, err %v", len(again), err)
	}
	rows, _ := app.FindRecordsByFilter("reflection_window", "reflection_id = {:id}", "", 0, 0, map[string]any{"id": refl.Id})
	if len(rows) != 3 {
		t.Fatalf("reflection_window rows = %d, want 3 (idempotent)", len(rows))
	}

	series := SeriesWindows(app, refl, now)
	if len(series) != 4 {
		t.Fatalf("series = %d windows, want 3 backfilled + 1 grid", len(series))
	}
	if !series[0].Backfilled || series[3].Backfilled {
		t.Errorf("backfilled flags wrong: %+v", series)
	}
	if got := PendingWindows(app, refl, now); len(got) != 4 {
		t.Errorf("pending = %d, want all 4", len(got))
	}

	if _, err := MaterializeBackfill(app, refl, eff.Add(day), now); err != ErrBackfillOutOfRange {
		t.Errorf("backfill inside the covered range: err = %v, want ErrBackfillOutOfRange", err)
	}
}
