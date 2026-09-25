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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
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
		"output":        "",
		"output_draft":  "one\n\ntwo",
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
		`{"blockPosition":1,"newText":"TWO"}`, map[string]string{"id": proj.Id, "rid": src.Id})
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
	if res.FragmentID != "" || res.Edit.ID == "" {
		t.Errorf("response = %+v, want empty fragment id and valid edit by default", res)
	}
	snap, err := app.FindRecordById("projection_snapshot", src.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("output"); got != "" {
		t.Errorf("edited output = %q, want empty until approved", got)
	}
	if got := snap.GetString("output_draft"); got != "one\n\nTWO" {
		t.Errorf("edited output_draft = %q, want %q", got, "one\n\nTWO")
	}
	edits := engine.LoadSnapshotEdits(snap)
	if len(edits) != 1 || edits[0].Status != api.EditStatusApproved {
		t.Errorf("edits = %+v, want 1 approved edit", edits)
	}

	// Out of bounds blockPosition: 400.
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"blockPosition":10,"newText":"x"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusBadRequest {
		t.Errorf("out of bounds: status = %d, want 400 (%v)", code, err)
	}

	// Identical text: 422.
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"blockPosition":0,"newText":"one"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusUnprocessableEntity {
		t.Errorf("identical text: status = %d, want 422 (%v)", code, err)
	}

	// Another projection's candidate: 404.
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost,
		"/api/projections/"+other.Id+"/candidates/"+src.Id+"/edit",
		`{"blockPosition":0,"newText":"x"}`, map[string]string{"id": other.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Errorf("foreign candidate: status = %d, want 404 (%v)", code, err)
	}

	// Approve the source; it is no longer editable: 409.
	if err := engine.ApproveSnapshot(t.Context(), app, projections.Strategy{}, src.Id); err != nil {
		t.Fatal(err)
	}
	_, err = callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"blockPosition":0,"newText":"x"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Errorf("approved candidate: status = %d, want 409 (%v)", code, err)
	}
}

func TestUpdateSnapshotEditStatusRoute(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	editID := "edit-h1"
	marker := engine.FormatEditMarker(editID)
	src.Set("output_draft", "one\n\n"+marker)
	edits := []api.SnapshotEdit{
		{
			ID:            editID,
			Sequence:      1,
			Type:          api.EditTypeRegeneration,
			Status:        api.EditStatusProposed,
			ContentBefore: "two",
			ContentAfter:  "TWO",
			BlockIndex:    1,
		},
	}
	src.Set("edits", pbutil.JSONObject(edits))
	if err := app.Save(src); err != nil {
		t.Fatal(err)
	}

	path := "/api/projections/" + proj.Id + "/candidates/" + src.Id + "/edits/" + editID
	rec, err := callJSON(t, app, HandleUpdateSnapshotEditStatus(app), http.MethodPost, path,
		`{"status":"approved"}`, map[string]string{"id": proj.Id, "rid": src.Id, "eid": editID})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var res api.UpdateSnapshotEditStatusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Edit.Status != api.EditStatusApproved {
		t.Errorf("status = %s, want approved", res.Edit.Status)
	}
	snap, err := app.FindRecordById("projection_snapshot", src.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("output_draft"); got != "one\n\nTWO" {
		t.Errorf("output_draft = %q, want %q", got, "one\n\nTWO")
	}

	rec, err = callJSON(t, app, HandleUpdateSnapshotEditStatus(app), http.MethodPost, path,
		`{"status":"proposed"}`, map[string]string{"id": proj.Id, "rid": src.Id, "eid": editID})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Edit.Status != api.EditStatusProposed {
		t.Errorf("status = %s, want proposed", res.Edit.Status)
	}
	snap, err = app.FindRecordById("projection_snapshot", src.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("output_draft"); got != "one\n\n"+marker {
		t.Errorf("output_draft after undo = %q, want %q", got, "one\n\n"+marker)
	}
}

func TestEditCandidateRouteCreatesFragmentWhenEnabled(t *testing.T) {
	t.Setenv("KALAIDO_HAND_EDIT_CREATE_FRAGMENT", "1")
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	path := "/api/projections/" + proj.Id + "/candidates/" + src.Id + "/edit"

	rec, err := callJSON(t, app, HandleEditCandidate(app), http.MethodPost, path,
		`{"blockPosition":1,"newText":"TWO"}`, map[string]string{"id": proj.Id, "rid": src.Id})
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
	if res.FragmentID == "" || res.Edit.ID == "" {
		t.Errorf("response = %+v, want fragment id and edit", res)
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
