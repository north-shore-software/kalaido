package projections_test

import (
	"context"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestProjectionDomainCRUD(t *testing.T) {
	app := testutil.NewApp(t)

	// 1. Create
	rec, err := projections.Create(app, projections.CreateParams{
		Name:        "Test Projection",
		Description: "A test description",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if rec.GetString("name") != "Test Projection" {
		t.Errorf("name = %q, want 'Test Projection'", rec.GetString("name"))
	}
	if rec.GetString("status") != engine.EntityActive {
		t.Errorf("status = %q, want active", rec.GetString("status"))
	}

	// 2. Update
	newName := "Updated Name"
	updated, err := projections.Update(app, rec.Id, projections.UpdateParams{
		Name: &newName,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.GetString("name") != "Updated Name" {
		t.Errorf("name = %q, want 'Updated Name'", updated.GetString("name"))
	}

	// 3. Set up dependent projection sourcing this one to verify scrub
	depRec, err := projections.Create(app, projections.CreateParams{
		Name: "Dependent Projection",
	})
	if err != nil {
		t.Fatalf("Create dependent failed: %v", err)
	}
	depSpec := api.ContextSpec{
		SourceProjectionIDs: []string{rec.Id, "other_id"},
	}
	depRec.Set("current_context_spec", pbutil.JSONObject(depSpec))
	if err := app.Save(depRec); err != nil {
		t.Fatalf("save dependent: %v", err)
	}

	// 4. Delete
	if err := projections.Delete(app, rec.Id); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify soft-deleted
	deletedRec, err := app.FindRecordById(schema.ColProjection.String(), rec.Id)
	if err != nil {
		t.Fatalf("record should still exist in db: %v", err)
	}
	if !engine.IsDeleted(deletedRec) {
		t.Error("record deleted_at should not be empty")
	}

	// Verify dependent context spec was scrubbed
	depReloaded, err := app.FindRecordById(schema.ColProjection.String(), depRec.Id)
	if err != nil {
		t.Fatalf("reload dependent: %v", err)
	}
	var loadedSpec api.ContextSpec
	if err := depReloaded.UnmarshalJSONField("current_context_spec", &loadedSpec); err != nil {
		t.Fatalf("unmarshal context spec: %v", err)
	}
	if len(loadedSpec.SourceProjectionIDs) != 1 || loadedSpec.SourceProjectionIDs[0] != "other_id" {
		t.Errorf("SourceProjectionIDs = %v, want ['other_id']", loadedSpec.SourceProjectionIDs)
	}

	// 5. Restore
	restored, err := projections.Restore(app, rec.Id)
	if err != nil {
		t.Fatalf("Restore failed: %v", err)
	}
	if engine.IsDeleted(restored) {
		t.Error("restored record should have empty deleted_at")
	}
}

func TestProjectionApprove(t *testing.T) {
	app := testutil.NewApp(t)
	ctx := context.Background()

	p, err := projections.Create(app, projections.CreateParams{Name: "P"})
	if err != nil {
		t.Fatal(err)
	}
	lens := testutil.NewRecord(t, app, schema.ColLens.String(), map[string]any{
		"prompt": "Test lens",
	})
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": p.Id,
		"lens_id":       lens.Id,
		"output":        "Valid content",
		"status":        engine.StatusPending,
	})

	if err := projections.Approve(ctx, app, snap.Id); err != nil {
		t.Fatalf("Approve failed: %v", err)
	}

	approvedSnap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	if approvedSnap.GetString("status") != engine.StatusApproved {
		t.Errorf("status = %q, want %q", approvedSnap.GetString("status"), engine.StatusApproved)
	}
	if approvedSnap.GetInt("approval_sequence_number") != 1 {
		t.Errorf("seq = %d, want 1", approvedSnap.GetInt("approval_sequence_number"))
	}
}
