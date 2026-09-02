package status_test

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func dated(t *testing.T, app core.App, content string, at time.Time) *core.Record {
	t.Helper()
	d, _ := types.ParseDateTime(at)
	return testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": content, "source_time": d})
}

func statusOf(t *testing.T, app core.App, id string, now time.Time) api.EntityStatus {
	t.Helper()
	statuses, err := status.NewEvaluator(app, now).EvaluateAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range statuses {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("entity %s not evaluated", id)
	return api.EntityStatus{}
}

// Staleness is per window: a fragment dated inside an already-summarized
// window flags that window only; one dated in no window flags nothing.
func TestReflectionStalenessIsPerWindow(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := time.Now().Add(-16 * day).UTC().Truncate(time.Second)
	now := time.Now()

	spec := api.ContextSpec{WholeScope: true}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": pbutil.JSONString("L"), "context_spec": pbutil.JSONObject(spec),
	})
	versions := engine.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	grid := engine.CurrentGridWindows(refl, now)
	if len(grid) != 2 {
		t.Fatalf("grid = %d, want 2", len(grid))
	}

	f1 := dated(t, app, "week one, seen", eff.Add(2*day))
	f2 := dated(t, app, "week two, seen", eff.Add(9*day))
	for i, w := range grid {
		seen := []string{f1.Id, f2.Id}[i]
		testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
			"reflection_id": refl.Id, "status": engine.StatusApproved, "approval_sequence_number": 1,
			"lens_id": lens.Id, "output": pbutil.JSONString("summary"),
			"window_key":       engine.WindowKey(w),
			"resolved_window":  pbutil.JSONObject(map[string]string{"start": w.Start, "end": w.End}),
			"resolved_context": pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{seen}}),
		})
	}

	s := statusOf(t, app, refl.Id, now)
	if s.UpToDateSnapshotID == "" || len(s.StaleWindows) != 0 || len(s.NewFragmentIDs) != 0 || len(s.PendingWindows) != 0 {
		t.Fatalf("fresh series reads stale: %+v", s)
	}

	// Outside every window: before the schedule began, and in the open week.
	dated(t, app, "ancient", eff.Add(-30*day))
	dated(t, app, "this week, still open", now.Add(-time.Hour))
	s = statusOf(t, app, refl.Id, now)
	if len(s.StaleWindows) != 0 || len(s.NewFragmentIDs) != 0 {
		t.Fatalf("fragments outside every window flagged: %+v", s)
	}

	// Backdated into week one.
	late := dated(t, app, "late email from week one", eff.Add(3*day))
	s = statusOf(t, app, refl.Id, now)
	if len(s.StaleWindows) != 1 || s.StaleWindows[0].ID != grid[0].ID {
		t.Fatalf("stale windows = %+v, want week one only", s.StaleWindows)
	}
	if len(s.NewFragmentIDs) != 1 || s.NewFragmentIDs[0] != late.Id {
		t.Errorf("new fragments = %v, want the late one", s.NewFragmentIDs)
	}
	if s.UpToDateSnapshotID != "" {
		t.Errorf("stale reflection reports an up-to-date snapshot")
	}
}
