package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestHandleGeneratePendingReflections(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{}
	})

	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := time.Now().Add(-16 * day).UTC().Truncate(time.Second)
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)

	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "Summarize the week."})
	oldLens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "Older lens."})

	// Seed fragments inside week 1 and week 2.
	w1Time, _ := types.ParseDateTime(eff.Add(2 * day))
	w2Time, _ := types.ParseDateTime(eff.Add(9 * day))
	f1 := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "week 1 note", "occurred_at": w1Time})
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "week 2 note", "occurred_at": w2Time})

	// 1. Active reflection A: 2 grid windows, week 1 already approved (even with
	// a backdated fragment added later and an older lens), week 2 pending.
	reflA := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Weekly A",
		"status":               engine.EntityActive,
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	gridA := reflections.CurrentGridWindows(reflA, time.Now())
	if len(gridA) != 2 {
		t.Fatalf("gridA = %d, want 2", len(gridA))
	}
	w1Snap := testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
		"reflection_id":            reflA.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"lens_id":                  oldLens.Id,
		"output":                   "EXISTING WEEK 1",
		"window_start":             gridA[0].Start,
		"window_end":               gridA[0].End,
		"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{f1.Id}}),
	})
	// Add a backdated fragment into week 1 so week 1 is stale; it must still NOT be regenerated.
	lateW1, _ := types.ParseDateTime(eff.Add(3 * day))
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "late week 1 note", "occurred_at": lateW1})

	// 2. Active reflection B: 2 grid windows, both pending.
	reflB := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Weekly B",
		"status":               engine.EntityActive,
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	// 3. Active lensless reflection: must be skipped without aborting others.
	reflNoLens := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "No Lens",
		"status":               engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	// 4. Proposed reflection: must be ignored.
	reflProposed := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Proposed",
		"status":               engine.EntityProposed,
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	// 5. Soft-deleted reflection: must be ignored.
	reflDeleted := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Deleted",
		"status":               engine.EntityActive,
		"deleted_at":           types.NowDateTime(),
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	// 6. Active stale projection: must never be touched.
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "Stale Projection",
		"status":               engine.EntityActive,
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
	})

	rec, err := callJSON(t, app, HandleGeneratePendingReflections(app), http.MethodPost, "/api/reflections/generate-pending", "", nil)
	if err != nil {
		t.Fatalf("generate-pending: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}

	var res api.ReflectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// Expect 1 snapshot for reflA (week 2 only) + 2 snapshots for reflB = 3 total.
	if len(res.SnapshotIDs) != 3 {
		t.Fatalf("snapshotIds = %v (len %d), want 3", res.SnapshotIDs, len(res.SnapshotIDs))
	}

	snapsFor := func(col, fk, id string) []*core.Record {
		t.Helper()
		recs, err := app.FindRecordsByFilter(col, fk+" = {:id}", "", 0, 0, dbx.Params{"id": id})
		if err != nil {
			t.Fatal(err)
		}
		return recs
	}

	// reflA must have exactly 2 snapshots: untouched w1Snap + newly generated week 2.
	aSnaps := snapsFor(schema.ColReflectionSnapshot.String(), "reflection_id", reflA.Id)
	if len(aSnaps) != 2 {
		t.Fatalf("reflA snapshots = %d, want 2 (week 1 untouched, week 2 generated)", len(aSnaps))
	}
	w1After, err := app.FindRecordById(schema.ColReflectionSnapshot.String(), w1Snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	if w1After.GetString("output") != "EXISTING WEEK 1" || w1After.GetString("lens_id") != oldLens.Id {
		t.Errorf("already-approved week 1 snapshot was modified: output=%q lens_id=%q", w1After.GetString("output"), w1After.GetString("lens_id"))
	}

	// reflB must have 2 approved snapshots.
	bSnaps := snapsFor(schema.ColReflectionSnapshot.String(), "reflection_id", reflB.Id)
	if len(bSnaps) != 2 {
		t.Fatalf("reflB snapshots = %d, want 2", len(bSnaps))
	}
	for _, s := range bSnaps {
		if s.GetString("status") != engine.StatusApproved {
			t.Errorf("reflB snapshot %s status = %q, want approved", s.Id, s.GetString("status"))
		}
	}

	// Lensless, proposed, deleted reflections and projections must have 0 snapshots.
	for name, id := range map[string]string{
		"lensless": reflNoLens.Id,
		"proposed": reflProposed.Id,
		"deleted":  reflDeleted.Id,
	} {
		if got := snapsFor(schema.ColReflectionSnapshot.String(), "reflection_id", id); len(got) != 0 {
			t.Errorf("%s reflection got %d snapshots, want 0", name, len(got))
		}
	}
	if got := snapsFor(schema.ColProjectionSnapshot.String(), "projection_id", proj.Id); len(got) != 0 {
		t.Errorf("projection got %d snapshots, want 0", len(got))
	}

	// Second call when nothing is pending returns 200 with empty JSON array [].
	rec2, err := callJSON(t, app, HandleGeneratePendingReflections(app), http.MethodPost, "/api/reflections/generate-pending", "", nil)
	if err != nil {
		t.Fatalf("second generate-pending: %v", err)
	}
	if rec2.Code != http.StatusOK {
		t.Fatalf("second status = %d, want 200; body %s", rec2.Code, rec2.Body.String())
	}
	if got := rec2.Body.String(); got != "{\"snapshotIds\":[]}\n" && got != "{\"snapshotIds\":[]}" {
		t.Errorf("empty response body = %q, want {\"snapshotIds\":[]}", got)
	}
}
