package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// GET /api/status reports every worker, including the colour worker and the
// wave policy, over an idle fleet.
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
	if st.Reconcile.Running || st.Policy.Wave {
		t.Errorf("reconcile = %+v policy = %+v, want idle with automatic waves off", st.Reconcile, st.Policy)
	}
	if st.Discover.State != api.DiscoverStateNeverRun {
		t.Errorf("discover state = %s, want never_run", st.Discover.State)
	}
}

// GET /api/reconcile is the wave's state beside every entity's freshness.
func TestGetReconcileCombinesWaveAndStaleness(t *testing.T) {
	app := testutil.NewApp(t)
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "P", "status": engine.EntityActive})
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "new"})

	deps := testDeps(app)
	rec, err := callJSON(t, app, HandleGetReconcile(app, deps.Reconcile), http.MethodGet, "/api/reconcile", "", nil)
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
	if plan.Running {
		t.Error("wave reported running while never started")
	}
	if len(plan.Statuses) != 1 || plan.Statuses[0].ID != proj.Id || plan.Statuses[0].Type != "projection" {
		t.Fatalf("statuses = %+v, want the one projection", plan.Statuses)
	}
	if plan.Statuses[0].UpToDateSnapshotID != "" {
		t.Errorf("a projection with no snapshot must not be up to date: %+v", plan.Statuses[0])
	}

	// The wire shape is flat: the wave fields sit beside "statuses".
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(rec.Body.Bytes(), &raw)
	for _, key := range []string{"running", "statuses"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("response missing %q: %s", key, rec.Body.String())
		}
	}
}
