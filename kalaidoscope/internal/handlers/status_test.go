package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// GET /api/status reports every worker, including the colour worker, over an
// idle fleet.
func TestGetStatusReportsEveryWorker(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "one"})
	testutil.NewRecord(t, app, "colour", map[string]any{"name": "Blue", "swatch": 0, "prompt": "about blue things"})

	rec, err := callJSON(t, app, HandleGetStatus(app, testDeps(app)), http.MethodGet, "/api/status", "", nil)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var st api.KalaidoscopeStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Fragments != 1 {
		t.Errorf("fragments = %d, want 1", st.Fragments)
	}
	if st.Map.State != api.MapStateUnannotated || st.Map.PendingAnnotation != 1 {
		t.Errorf("map = %+v, want unannotated with 1 pending", st.Map)
	}
	if st.Colour.TotalColoursCount != 1 || st.Colour.PromptColoursCount != 1 || st.Colour.UnjudgedFragments != 1 {
		t.Errorf("colour = %+v, want 1 colour with a prompt and 1 unjudged fragment", st.Colour)
	}
	if st.Colour.Draining {
		t.Error("colour worker reported draining while never started")
	}
	if st.Discover.State != api.DiscoverStateNeverRun {
		t.Errorf("discover state = %s, want never_run", st.Discover.State)
	}
}

// GET /api/status counts unjudged fragments past a prompt colour's watermark
// without failing SQL evaluation.
func TestGetStatusCountsUnjudgedFragmentsPastWatermark(t *testing.T) {
	app := testutil.NewApp(t)
	f1 := testutil.NewRecord(t, app, "fragment", map[string]any{
		"id": "frag00000000001", "type": "note", "content": "one",
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"id": "frag00000000002", "type": "note", "content": "two",
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"id": "frag00000000003", "type": "note", "content": "deleted",
		"deleted_at": "2026-01-01 00:00:04.000Z",
	})
	testutil.NewRecord(t, app, "colour", map[string]any{
		"name":   "Blue",
		"swatch": 0,
		"prompt": "about blue things",
		"prompt_match_completed_up_to_fragment_id": f1.Id,
	})

	rec, err := callJSON(t, app, HandleGetStatus(app, testDeps(app)), http.MethodGet, "/api/status", "", nil)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var st api.KalaidoscopeStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Colour.UnjudgedFragments != 1 {
		t.Errorf("unjudgedFragments = %d, want 1", st.Colour.UnjudgedFragments)
	}
}

// GET /api/reconcile reports every active entity's freshness.
func TestGetReconcileReturnsEntityStaleness(t *testing.T) {
	app := testutil.NewApp(t)
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "P", "status": engine.EntityActive})
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "new"})

	rec, err := callJSON(t, app, HandleGetReconcile(app), http.MethodGet, "/api/reconcile", "", nil)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var plan api.ReconcilePlanResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Statuses) != 1 || plan.Statuses[0].ID != proj.Id || plan.Statuses[0].Type != "projection" {
		t.Fatalf("statuses = %+v, want the one projection", plan.Statuses)
	}
	if plan.Statuses[0].UpToDateSnapshotID != "" {
		t.Errorf("a projection with no snapshot must not be up to date: %+v", plan.Statuses[0])
	}

	var raw map[string]json.RawMessage
	_ = json.Unmarshal(rec.Body.Bytes(), &raw)
	if _, ok := raw["statuses"]; !ok {
		t.Errorf("response missing %q: %s", "statuses", rec.Body.String())
	}
	if _, ok := raw["running"]; ok {
		t.Errorf("response unexpectedly includes wave field %q: %s", "running", rec.Body.String())
	}
}
