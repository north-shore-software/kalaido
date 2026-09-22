package reflections_test

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestReflectionDomainCRUD(t *testing.T) {
	app := testutil.NewApp(t)

	// 1. Create
	rec, err := reflections.Create(app, reflections.CreateParams{
		Name:        "Daily Reflection",
		Description: "Daily review reflection",
		WindowSpec: &api.WindowSpec{
			Period:    "24h",
			Duration:  "24h",
			StartTime: "2026-01-01T00:00:00Z",
		},
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if rec.GetString("name") != "Daily Reflection" {
		t.Errorf("name = %q, want 'Daily Reflection'", rec.GetString("name"))
	}
	if rec.GetString("status") != engine.EntityActive {
		t.Errorf("status = %q, want active", rec.GetString("status"))
	}
	versions := reflections.LoadWindowSpecVersions(rec)
	if len(versions) != 1 {
		t.Errorf("versions len = %d, want 1", len(versions))
	}

	// 2. Update
	newName := "Updated Reflection"
	updated, err := reflections.Update(app, rec.Id, reflections.UpdateParams{
		Name: &newName,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.GetString("name") != "Updated Reflection" {
		t.Errorf("name = %q, want 'Updated Reflection'", updated.GetString("name"))
	}

	// 3. Dependent reflection sourcing this one to verify scrub
	depRec, err := reflections.Create(app, reflections.CreateParams{
		Name: "Dependent Reflection",
	})
	if err != nil {
		t.Fatalf("Create dependent failed: %v", err)
	}
	depSpec := api.ContextSpec{
		SourceReflectionIDs: []string{rec.Id, "other_refl"},
	}
	depRec.Set("current_context_spec", pbutil.JSONObject(depSpec))
	if err := app.Save(depRec); err != nil {
		t.Fatalf("save dependent: %v", err)
	}

	// 4. Delete
	if err := reflections.Delete(app, rec.Id); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify soft-deleted
	deletedRec, err := app.FindRecordById(schema.ColReflection.String(), rec.Id)
	if err != nil {
		t.Fatalf("record should still exist in db: %v", err)
	}
	if !engine.IsDeleted(deletedRec) {
		t.Error("record deleted_at should not be empty")
	}

	// Verify dependent context spec was scrubbed
	depReloaded, err := app.FindRecordById(schema.ColReflection.String(), depRec.Id)
	if err != nil {
		t.Fatalf("reload dependent: %v", err)
	}
	var loadedSpec api.ContextSpec
	if err := depReloaded.UnmarshalJSONField("current_context_spec", &loadedSpec); err != nil {
		t.Fatalf("unmarshal context spec: %v", err)
	}
	if len(loadedSpec.SourceReflectionIDs) != 1 || loadedSpec.SourceReflectionIDs[0] != "other_refl" {
		t.Errorf("SourceReflectionIDs = %v, want ['other_refl']", loadedSpec.SourceReflectionIDs)
	}

	// 5. Restore
	restored, err := reflections.Restore(app, rec.Id)
	if err != nil {
		t.Fatalf("Restore failed: %v", err)
	}
	if engine.IsDeleted(restored) {
		t.Error("restored record should have empty deleted_at")
	}
}
