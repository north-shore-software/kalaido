package mapping

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestLoadDocumentInitializesEmpty(t *testing.T) {
	app := testutil.NewApp(t)

	d, err := loadDocument(app)
	if err != nil {
		t.Fatalf("loadDocument failed: %v", err)
	}
	if d.version != 0 {
		t.Errorf("version = %d, want 0", d.version)
	}
	if d.doc == nil || len(d.doc.Things) != 0 {
		t.Errorf("expected an empty document, got %+v", d.doc)
	}
	if d.rec == nil || d.rec.Id == "" {
		t.Fatal("first load should have written the map row")
	}
	again, err := loadDocument(app)
	if err != nil {
		t.Fatal(err)
	}
	if again.rec.Id != d.rec.Id {
		t.Errorf("second load found a different row: %s vs %s", again.rec.Id, d.rec.Id)
	}
}
