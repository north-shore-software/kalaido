package handlers

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// deleteFixture: projection A (with an approved snapshot), and a projection
// and a reflection that both source A.
func deleteFixture(t *testing.T, app core.App) (a, dependentProj, dependentRefl, snap *core.Record) {
	t.Helper()
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "LENS", "context_spec": pbutil.JSONObject(spec)})
	a = testutil.NewRecord(t, app, "projection", map[string]any{
		"name": "A", "status": "active",
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
	})
	snap = testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": a.Id, "lens_id": lens.Id, "output": "A's text",
		"status": engine.StatusApproved, "approval_sequence_number": 1,
		"context_spec": pbutil.JSONObject(spec),
	})
	sourced := api.ContextSpec{SourceProjectionIDs: []string{a.Id, "other"}}
	dependentProj = testutil.NewRecord(t, app, "projection", map[string]any{
		"name": "B", "status": "active", "current_context_spec": pbutil.JSONObject(sourced),
	})
	dependentRefl = testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "C", "status": "active", "current_context_spec": pbutil.JSONObject(sourced),
	})
	return
}

func sourceIDs(t *testing.T, app core.App, col, id string) []string {
	t.Helper()
	rec, err := app.FindRecordById(col, id)
	if err != nil {
		t.Fatal(err)
	}
	var spec api.ContextSpec
	if err := rec.UnmarshalJSONField("current_context_spec", &spec); err != nil {
		t.Fatal(err)
	}
	return spec.SourceProjectionIDs
}

func TestDeleteProjectionSoftDeletesAndScrubs(t *testing.T) {
	app := testutil.NewApp(t)
	a, b, c, snap := deleteFixture(t, app)
	params := map[string]string{"id": a.Id}

	rec, err := callJSON(t, app, HandleDeleteProjection(app), http.MethodDelete, "/api/projections/"+a.Id, "", params)
	if err != nil || rec.Code != http.StatusNoContent {
		t.Fatalf("delete: code=%d err=%v", rec.Code, err)
	}

	got, err := app.FindRecordById("projection", a.Id)
	if err != nil {
		t.Fatalf("row must survive a soft delete: %v", err)
	}
	if !engine.IsDeleted(got) {
		t.Fatal("deleted_at not stamped")
	}
	if _, err := app.FindRecordById("projection_snapshot", snap.Id); err != nil {
		t.Errorf("snapshot must survive: %v", err)
	}
	for _, dep := range []struct{ col, id string }{{"projection", b.Id}, {"reflection", c.Id}} {
		ids := sourceIDs(t, app, dep.col, dep.id)
		if len(ids) != 1 || ids[0] != "other" {
			t.Errorf("%s %s sourceProjectionIds = %v, want [other]", dep.col, dep.id, ids)
		}
	}

	// Idempotent.
	rec, err = callJSON(t, app, HandleDeleteProjection(app), http.MethodDelete, "/api/projections/"+a.Id, "", params)
	if err != nil || rec.Code != http.StatusNoContent {
		t.Fatalf("second delete: code=%d err=%v", rec.Code, err)
	}

	// Invisible to staleness and to context resolution while deleted.
	statuses, err := reconcile.NewEvaluator(app, time.Now()).EvaluateAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range statuses {
		if s.ID == a.Id {
			t.Error("deleted projection still evaluated")
		}
	}
	pinned, _ := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{SourceProjectionIDs: []string{a.Id}}, nil)
	if len(pinned.SnapshotIDs) != 0 {
		t.Errorf("deleted projection's snapshot resolved as context: %v", pinned.SnapshotIDs)
	}

	// Writes are refused as not found; restore is not.
	_, err = callJSON(t, app, HandleUpdateProjection(app), http.MethodPatch, "/api/projections/"+a.Id, `{"name":"x"}`, params)
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Errorf("update deleted: status = %d, want 404 (%v)", code, err)
	}
	rec, err = callJSON(t, app, HandleRestoreProjection(app), http.MethodPost, "/api/projections/"+a.Id+"/restore", "", params)
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("restore: code=%d err=%v", rec.Code, err)
	}
	got, _ = app.FindRecordById("projection", a.Id)
	if engine.IsDeleted(got) {
		t.Fatal("restore did not clear deleted_at")
	}
	pinned, _ = llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{SourceProjectionIDs: []string{a.Id}}, nil)
	if len(pinned.SnapshotIDs) != 1 || pinned.SnapshotIDs[0] != snap.Id {
		t.Errorf("restored projection's snapshot not resolved: %v", pinned.SnapshotIDs)
	}
	// Scrubbed references are not re-added.
	if ids := sourceIDs(t, app, "projection", b.Id); len(ids) != 1 {
		t.Errorf("restore re-added a scrubbed reference: %v", ids)
	}
}

func TestDeleteProjectionRefusedWhileGenerating(t *testing.T) {
	app := testutil.NewApp(t)
	a, _, _, _ := deleteFixture(t, app)
	params := map[string]string{"id": a.Id}
	claim := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": a.Id, "status": engine.StatusGenerating,
	})

	_, err := callJSON(t, app, HandleDeleteProjection(app), http.MethodDelete, "/api/projections/"+a.Id, "", params)
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Fatalf("delete with live claim: status = %d, want 409 (%v)", code, err)
	}

	// A claim past the TTL belongs to a crashed run and does not block.
	claim.SetRaw("created", types.NowDateTime().Add(-11*time.Minute))
	if err := app.Save(claim); err != nil {
		t.Fatal(err)
	}
	rec, err := callJSON(t, app, HandleDeleteProjection(app), http.MethodDelete, "/api/projections/"+a.Id, "", params)
	if err != nil || rec.Code != http.StatusNoContent {
		t.Fatalf("delete with stale claim: code=%d err=%v", rec.Code, err)
	}
}

func TestDeleteReflectionScrubsSourceReflectionIDs(t *testing.T) {
	app := testutil.NewApp(t)
	r := testutil.NewRecord(t, app, "reflection", map[string]any{"name": "R", "status": "active"})
	dep := testutil.NewRecord(t, app, "projection", map[string]any{
		"name": "P", "status": "active",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{SourceReflectionIDs: []string{r.Id}}),
	})
	rec, err := callJSON(t, app, HandleDeleteReflection(app), http.MethodDelete, "/api/reflections/"+r.Id, "", map[string]string{"id": r.Id})
	if err != nil || rec.Code != http.StatusNoContent {
		t.Fatalf("delete: code=%d err=%v", rec.Code, err)
	}
	got, _ := app.FindRecordById("projection", dep.Id)
	var spec api.ContextSpec
	_ = got.UnmarshalJSONField("current_context_spec", &spec)
	if len(spec.SourceReflectionIDs) != 0 {
		t.Errorf("sourceReflectionIds = %v, want empty", spec.SourceReflectionIDs)
	}
}
