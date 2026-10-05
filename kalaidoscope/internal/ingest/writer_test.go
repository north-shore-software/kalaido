package ingest

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func countFragments(t *testing.T, app core.App) int {
	t.Helper()
	n, err := app.CountRecords("fragment")
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

func TestWriterBatchesIntoTransactions(t *testing.T) {
	app := testutil.NewApp(t)
	w, err := newWriter(app, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	w.origin = "import"
	w.batch = 2

	for _, c := range []string{"one", "two", "three", "two", "four", "five"} {
		if err := w.addAt("note", "src", c, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	// Five distinct contents: two full pages committed, one still pending.
	if w.count != 4 || len(w.pending) != 1 {
		t.Fatalf("before flush: count=%d pending=%d, want 4 and 1", w.count, len(w.pending))
	}
	if got := countFragments(t, app); got != 4 {
		t.Fatalf("rows before flush = %d, want 4", got)
	}
	if err := w.flush(); err != nil {
		t.Fatal(err)
	}
	if w.count != 5 || countFragments(t, app) != 5 || w.lastID == "" {
		t.Fatalf("after flush: count=%d rows=%d lastID=%q", w.count, countFragments(t, app), w.lastID)
	}
}

func TestWriterLimitCountsPending(t *testing.T) {
	app := testutil.NewApp(t)
	w, err := newWriter(app, 3, false)
	if err != nil {
		t.Fatal(err)
	}
	w.batch = 10
	for _, c := range []string{"a", "b", "c"} {
		if err := w.addAt("note", "", c, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if !w.full() {
		t.Fatal("writer holding its limit in pending records should read as full")
	}
}

func TestRunFlushesTheTail(t *testing.T) {
	app := testutil.NewApp(t)
	n, err := run(context.Background(), app, options{
		Format:     "text",
		SourceName: "notes.txt",
		Data:       []byte("a single text fragment"),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 || countFragments(t, app) != 1 {
		t.Fatalf("run wrote %d (rows %d), want 1", n, countFragments(t, app))
	}
}

func TestSweepPendingFailsLeftovers(t *testing.T) {
	app := testutil.NewApp(t)
	stuck := testutil.NewRecord(t, app, "ingest", map[string]any{"status": "pending"})
	done := testutil.NewRecord(t, app, "ingest", map[string]any{"status": "done", "ingested": 3})

	SweepPending(app)

	got, err := app.FindRecordById("ingest", stuck.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetString("status") != "error" || got.GetString("error") != restartedError {
		t.Errorf("stuck record: status=%q error=%q", got.GetString("status"), got.GetString("error"))
	}
	got, err = app.FindRecordById("ingest", done.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetString("status") != "done" {
		t.Errorf("finished record was touched: status=%q", got.GetString("status"))
	}
}

func TestRunTagsCreatedFragmentsWithColour(t *testing.T) {
	app := testutil.NewApp(t)
	colour := testutil.NewRecord(t, app, "colour", map[string]any{"name": "c"})
	// Already present: the import's duplicate of it must not be tagged.
	testutil.NewRecord(t, app, "fragment", map[string]any{"content": "old news", "type": "note"})

	n, err := run(context.Background(), app, options{
		Format:         "text",
		SourceName:     "notes.txt",
		Data:           []byte("fresh"),
		SkipDuplicates: true,
		ColourID:       colour.Id,
		IngestRef:      "ingest-row",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("run wrote %d, want 1", n)
	}
	frags, err := app.FindRecordsByFilter("fragment", "ingest_ref = 'ingest-row'", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(frags) != 1 || frags[0].GetString("content") != "fresh" {
		t.Fatalf("fragments stamped with the ingest ref = %d, want the one created", len(frags))
	}
	links, err := app.FindRecordsByFilter("colour_fragment", "colour_id = {:c}", "", 0, 0, map[string]any{"c": colour.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0].GetString("fragment_id") != frags[0].Id || links[0].GetString("match_type") != schema.MatchIngest {
		t.Fatalf("colour rows = %d, want one \"ingest\" row for the created fragment", len(links))
	}

	// A second run of the same file: everything is a duplicate, nothing is
	// created, and the existing fragment is not retagged.
	if _, err := run(context.Background(), app, options{Format: "text", SourceName: "notes.txt", Data: []byte("fresh"), SkipDuplicates: true, ColourID: colour.Id}, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := app.CountRecords("colour_fragment"); got != 1 {
		t.Fatalf("colour rows after a duplicate run = %d, want 1", got)
	}
}
