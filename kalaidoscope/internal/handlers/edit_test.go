package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func editHandlerFixture(t *testing.T, app core.App) (proj, src *core.Record) {
	t.Helper()
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "LENS", "context_spec": pbutil.JSONObject(spec)})
	proj = testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "T",
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
	})
	src = testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": proj.Id,
		"lens_id":       lens.Id,
		"output":        "one\n\ntwo",
		"status":        engine.StatusPending,
		"context_spec":  pbutil.JSONObject(spec),
	})
	return proj, src
}

func TestEditCandidateRoute(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	other := testutil.NewRecord(t, app, "projection", map[string]any{"name": "Other"})
	path := "/api/projections/" + proj.Id + "/candidates/" + src.Id + "/edit"

	rec, err := callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"oldText":"two","newText":"TWO"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var res api.EditCandidateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.SnapshotID == "" || res.FragmentID == "" || res.SnapshotID == src.Id {
		t.Errorf("response = %+v, want a new snapshot id and a fragment id", res)
	}
	snap, err := app.FindRecordById("projection_snapshot", res.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("output"); got != "one\n\nTWO" {
		t.Errorf("edited output = %q", got)
	}

	// Text that is not in the candidate: 422.
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"oldText":"nope","newText":"x"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusUnprocessableEntity {
		t.Errorf("unknown text: status = %d, want 422 (%v)", code, err)
	}

	// Missing oldText: 400.
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"newText":"x"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusBadRequest {
		t.Errorf("empty oldText: status = %d, want 400 (%v)", code, err)
	}

	// Another projection's candidate: 404.
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost,
		"/api/projections/"+other.Id+"/candidates/"+src.Id+"/edit",
		`{"oldText":"two","newText":"x"}`, map[string]string{"id": other.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Errorf("foreign candidate: status = %d, want 404 (%v)", code, err)
	}

	// Approve the source; it is no longer editable: 409.
	if err := engine.ApproveSnapshot(t.Context(), app, engine.ProjectionStrategy{}, src.Id); err != nil {
		t.Fatal(err)
	}
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"oldText":"two","newText":"x"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Errorf("approved candidate: status = %d, want 409 (%v)", code, err)
	}
}

// apiErrorStatus is the HTTP status a handler's returned error carries, or 0
// for nil / a non-API error.
func apiErrorStatus(err error) int {
	var apiErr *router.ApiError
	if errors.As(err, &apiErr) {
		return apiErr.Status
	}
	return 0
}
