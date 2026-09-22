package ingest

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
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
