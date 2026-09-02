package engine

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// The runner generates exactly the pending set, oldest first, as approved
// snapshots filed under each window's key, and a second run has nothing to do.
func TestGeneratePendingWindowsFillsTheSeries(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "notes"})
	spec := api.ContextSpec{WholeScope: true}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": pbutil.JSONString("LENS"), "context_spec": pbutil.JSONObject(spec),
	})
	eff := time.Now().Add(-16 * day).UTC()
	versions := AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	var order []string
	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		if len(msgs) != 1 {
			return "", fmt.Errorf("unexpected transcript length %d", len(msgs))
		}
		order = append(order, msgs[0].Content)
		return fmt.Sprintf("OUT %d", len(order)), nil
	}}
	script.install(t)

	GeneratePendingWindows(app, refl.Id)

	grid := CurrentGridWindows(refl, time.Now())
	if len(grid) != 2 {
		t.Fatalf("grid = %d, want 2", len(grid))
	}
	for i, w := range grid {
		snaps, _ := app.FindRecordsByFilter("reflection_snapshot",
			"reflection_id = {:id} && window_key = {:k} && status = 'approved'", "", 0, 0,
			map[string]any{"id": refl.Id, "k": WindowKey(w)})
		if len(snaps) != 1 {
			t.Fatalf("window %d: %d approved snapshots, want 1", i, len(snaps))
		}
	}
	if len(order) != 2 {
		t.Fatalf("model calls = %d, want one per window", len(order))
	}
	start0, _ := WindowBounds(&grid[0])
	if want := start0.Time().Format("2006-01-02 15:04:05"); !contains(order[0], want) {
		t.Errorf("first call is not the oldest window (want bounds containing %q)", want)
	}
	if got := PendingWindows(app, refl, time.Now()); len(got) != 0 {
		t.Errorf("pending after run = %d, want 0", len(got))
	}

	GeneratePendingWindows(app, refl.Id)
	if len(order) != 2 {
		t.Errorf("second run made %d more calls, want none", len(order)-2)
	}
}

// Without a lens (nothing committed yet) the runner stops without persisting.
func TestGeneratePendingWindowsWaitsForLens(t *testing.T) {
	app := testutil.NewApp(t)
	eff := time.Now().Add(-16 * 24 * time.Hour).UTC()
	versions := AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": EntityActive,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	GeneratePendingWindows(app, refl.Id)
	snaps, _ := app.FindRecordsByFilter("reflection_snapshot", "reflection_id = {:id}", "", 0, 0, map[string]any{"id": refl.Id})
	if len(snaps) != 0 {
		t.Fatalf("persisted %d snapshots without a lens", len(snaps))
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
