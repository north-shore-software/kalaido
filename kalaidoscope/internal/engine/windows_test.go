package engine

import (
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

var t0 = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func assertWindows(t *testing.T, got []api.Window, want [][2]time.Time) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d windows, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i].Start != rfc(w[0]) || got[i].End != rfc(w[1]) {
			t.Errorf("window %d = [%s, %s), want [%s, %s)", i, got[i].Start, got[i].End, rfc(w[0]), rfc(w[1]))
		}
		if got[i].ID == "" {
			t.Errorf("window %d has no id", i)
		}
	}
}

// Tumbling (Duration == Period): contiguous windows, one per elapsed period,
// the still-open one excluded.
func TestGridWindowsTumbling(t *testing.T) {
	day := 24 * time.Hour
	got := GridWindows("r", api.WindowSpec{Period: "168h", Duration: "168h"}, t0, t0.Add(22*day))
	assertWindows(t, got, [][2]time.Time{
		{t0, t0.Add(7 * day)},
		{t0.Add(7 * day), t0.Add(14 * day)},
		{t0.Add(14 * day), t0.Add(21 * day)},
	})
}

// A missing Duration means tumbling.
func TestGridWindowsDefaultsDurationToPeriod(t *testing.T) {
	got := GridWindows("r", api.WindowSpec{Period: "24h"}, t0, t0.Add(25*time.Hour))
	assertWindows(t, got, [][2]time.Time{{t0, t0.Add(24 * time.Hour)}})
}

// Overlapping (Duration > Period): each window looks back a full Duration,
// truncated to the grid origin while the origin is inside it (spec/model.md
// §Boundary Semantics, first-window truncation).
func TestGridWindowsOverlappingTruncatesAtOrigin(t *testing.T) {
	day := 24 * time.Hour
	got := GridWindows("r", api.WindowSpec{Period: "24h", Duration: "72h"}, t0, t0.Add(4*day+time.Hour))
	assertWindows(t, got, [][2]time.Time{
		{t0, t0.Add(1 * day)},
		{t0, t0.Add(2 * day)},
		{t0, t0.Add(3 * day)},
		{t0.Add(1 * day), t0.Add(4 * day)},
	})
}

// Gapped (Duration < Period): the window is the Duration before each grid
// point; the leading gap after the origin is not covered.
func TestGridWindowsGapped(t *testing.T) {
	got := GridWindows("r", api.WindowSpec{Period: "24h", Duration: "1h"}, t0, t0.Add(48*time.Hour))
	assertWindows(t, got, [][2]time.Time{
		{t0.Add(23 * time.Hour), t0.Add(24 * time.Hour)},
		{t0.Add(47 * time.Hour), t0.Add(48 * time.Hour)},
	})
}

// "Summarize from <date>": a Start Time in the past with the lower bound set
// to it enumerates every window since — that is the backfill.
func TestGridWindowsStartTimeInPastEnumeratesHistory(t *testing.T) {
	day := 24 * time.Hour
	now := t0.Add(30 * day)
	got := GridWindows("r", api.WindowSpec{StartTime: rfc(t0), Period: "168h", Duration: "168h"}, t0, now)
	if len(got) != 4 {
		t.Fatalf("got %d windows, want 4 full weeks since start", len(got))
	}
	if got[0].Start != rfc(t0) {
		t.Errorf("first window starts %s, want the start time %s", got[0].Start, rfc(t0))
	}
}

// A later version keeps the grid origin but is effective from the edit: only
// windows ending after the lower bound are produced, so a cadence change
// never re-enumerates history as pending.
func TestGridWindowsLaterVersionDoesNotReenumerate(t *testing.T) {
	day := 24 * time.Hour
	effective := t0.Add(20 * day)
	got := GridWindows("r", api.WindowSpec{StartTime: rfc(t0), Period: "168h", Duration: "168h"}, effective, t0.Add(30*day))
	assertWindows(t, got, [][2]time.Time{
		{t0.Add(14 * day), t0.Add(21 * day)},
		{t0.Add(21 * day), t0.Add(28 * day)},
	})
}

func TestGridWindowsUnscheduled(t *testing.T) {
	if got := GridWindows("r", api.WindowSpec{}, t0, t0.Add(time.Hour)); got != nil {
		t.Fatalf("unscheduled spec produced windows: %+v", got)
	}
}

// Before the first grid point has passed the default target is the trailing
// window — one Duration ending now — so a brand-new reflection previews
// "today" rather than nothing at all.
func TestDefaultRefinementWindowTrailingBeforeFirstGridPoint(t *testing.T) {
	app := testutil.NewApp(t)
	now := t0.Add(2 * time.Hour)
	versions := AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, t0)
	rec := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "R", "window_spec_versions": pbutil.JSONObject(versions),
	})

	win := DefaultRefinementWindow(rec, now)
	if win == nil {
		t.Fatal("no default window")
	}
	if win.End != rfc(now) || win.Start != rfc(now.Add(-168*time.Hour)) {
		t.Errorf("window = [%s, %s), want the trailing week ending now", win.Start, win.End)
	}
}

// Once the grid has completed a window, that window is the default target.
func TestDefaultRefinementWindowIsCurrentGridWindow(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	versions := AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, t0)
	rec := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "R", "window_spec_versions": pbutil.JSONObject(versions),
	})

	win := DefaultRefinementWindow(rec, t0.Add(16*day))
	if win == nil {
		t.Fatal("no default window")
	}
	if win.Start != rfc(t0.Add(7*day)) || win.End != rfc(t0.Add(14*day)) {
		t.Errorf("window = [%s, %s), want the most recently completed week", win.Start, win.End)
	}
}

func TestDefaultRefinementWindowUnscheduledIsNil(t *testing.T) {
	app := testutil.NewApp(t)
	versions := AppendWindowSpecVersion(nil, api.WindowSpec{}, t0)
	rec := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "R", "window_spec_versions": pbutil.JSONObject(versions),
	})
	if win := DefaultRefinementWindow(rec, t0.Add(time.Hour)); win != nil {
		t.Fatalf("unscheduled reflection got a window: %+v", win)
	}
}
