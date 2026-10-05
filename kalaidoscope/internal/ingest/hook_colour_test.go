package ingest

import (
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// The create hook reads colour_id off the ingest record and the writer links
// every fragment it creates, end to end through the hook.
func TestIngestRecordWithColourLinksItsFragments(t *testing.T) {
	app := testutil.NewApp(t)
	maps := mapping.NewWorker(app)
	RegisterHooks(app, Deps{
		Mapping:   maps,
		Reconcile: reconcile.NewWorker(app, reconcile.Options{}),
		Discover:  discover.NewWorker(app, maps),
		Runner:    workerutil.InlineRunner{},
	})
	colour := testutil.NewRecord(t, app, "colour", map[string]any{"name": "c"})

	col, err := app.FindCollectionByNameOrId(schema.ColIngest.String())
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	f, err := filesystem.NewFileFromBytes([]byte("one fragment of text"), "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("file", []*filesystem.File{f})
	rec.Set("colour_id", colour.Id)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}

	got, err := app.FindRecordById(schema.ColIngest.String(), rec.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetString("status") != "done" || got.GetInt("ingested") != 1 {
		t.Fatalf("ingest: status=%q ingested=%d error=%q", got.GetString("status"), got.GetInt("ingested"), got.GetString("error"))
	}
	links, err := app.FindRecordsByFilter(schema.ColColourFragment.String(), "colour_id = {:c}", "", 0, 0, dbx.Params{"c": colour.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0].GetString("match_type") != schema.MatchIngest {
		t.Fatalf("colour rows = %d, want one %q row", len(links), schema.MatchIngest)
	}
	frag, err := app.FindRecordById(schema.ColFragment.String(), links[0].GetString("fragment_id"))
	if err != nil {
		t.Fatal(err)
	}
	if frag.GetString("ingest_ref") != rec.Id {
		t.Fatalf("ingest_ref = %q, want %q", frag.GetString("ingest_ref"), rec.Id)
	}
}
