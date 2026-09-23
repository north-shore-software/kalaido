package mapping

import (
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestLoadDocumentInitializesEmpty(t *testing.T) {
	app := testutil.NewApp(t)

	doc, ver, err := LoadDocument(app)
	if err != nil {
		t.Fatalf("LoadDocument failed: %v", err)
	}
	if ver != 0 {
		t.Errorf("version = %d, want 0", ver)
	}
	if doc == nil {
		t.Fatal("expected non-nil Document")
	}
	if len(doc.Things) != 0 {
		t.Errorf("expected 0 things, got %d", len(doc.Things))
	}
}

func TestResolveRefAndIndexRows(t *testing.T) {
	doc := &mapdoc.Document{
		Things: []mapdoc.Thing{
			{
				ID:      "t_item1",
				Name:    "Project Apollo",
				Aliases: []string{"Apollo"},
			},
		},
	}

	// ResolveRef
	if th := ResolveRef(doc, "Project Apollo"); th == nil || th.ID != "t_item1" {
		t.Errorf("ResolveRef by name failed: %v", th)
	}
	if th := ResolveRef(doc, "Apollo"); th == nil || th.ID != "t_item1" {
		t.Errorf("ResolveRef by alias failed: %v", th)
	}

	// IndexRows
	rows := []Row{
		{
			FragmentID: "f1",
			Date:       "2026-01-01",
			Things: []prompts.ThingCitation{
				{Ref: "Apollo"},
			},
		},
		{
			FragmentID: "f2",
			Date:       "2026-01-02",
			Things: []prompts.ThingCitation{
				{Name: "Project Apollo"},
			},
		},
		{
			FragmentID: "f3",
			Date:       "2026-01-03",
			Things: []prompts.ThingCitation{
				{Name: "Unknown"},
			},
		},
	}

	idx := IndexRows(doc, rows)
	apolloRows, ok := idx["t_item1"]
	if !ok || len(apolloRows) != 2 {
		t.Fatalf("expected 2 rows indexed for t_item1, got %v", apolloRows)
	}
	if apolloRows[0] != 0 || apolloRows[1] != 1 {
		t.Errorf("unexpected row indices: %v", apolloRows)
	}
}

func TestSortRowsByDate(t *testing.T) {
	rows := []prompts.AnnotationRow{
		{FragmentID: "f1", Date: "2026-05-01"},
		{FragmentID: "f2", Date: ""},
		{FragmentID: "f3", Date: "2026-02-01"},
	}
	sortRowsByDate(rows)
	if rows[0].FragmentID != "f2" || rows[1].FragmentID != "f3" || rows[2].FragmentID != "f1" {
		t.Errorf("unexpected sort order: %+v", rows)
	}
}
