// UNREVIEWED
package pbutil

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/pocketbase/pocketbase/tools/types"
)

func TestSoftDeleteAndRestore(t *testing.T) {
	app := testutil.NewApp(t)
	rec := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":   "test-proj",
		"status": "active",
	})

	if IsDeleted(rec) {
		t.Fatal("expected newly created record to not be deleted")
	}

	if err := SoftDelete(app, rec); err != nil {
		t.Fatalf("SoftDelete failed: %v", err)
	}

	if !IsDeleted(rec) {
		t.Fatal("expected record to be marked deleted after SoftDelete")
	}

	// Idempotent delete
	origTime := rec.GetDateTime("deleted_at")
	if err := SoftDelete(app, rec); err != nil {
		t.Fatalf("second SoftDelete failed: %v", err)
	}
	if rec.GetDateTime("deleted_at") != origTime {
		t.Fatal("expected second SoftDelete to be a no-op")
	}

	if err := Restore(app, rec); err != nil {
		t.Fatalf("Restore failed: %v", err)
	}

	if IsDeleted(rec) {
		t.Fatal("expected record to not be deleted after Restore")
	}
	if rec.GetDateTime("deleted_at") != (types.DateTime{}) {
		t.Fatalf("expected empty deleted_at, got %v", rec.GetDateTime("deleted_at"))
	}

	// Idempotent restore
	if err := Restore(app, rec); err != nil {
		t.Fatalf("second Restore failed: %v", err)
	}
}
