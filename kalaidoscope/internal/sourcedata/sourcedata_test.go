package sourcedata_test

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapdoc"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestFragments(t *testing.T) {
	app := testutil.NewApp(t)

	// Empty query returns nil, nil
	recs, err := sourcedata.FindFragmentsByIDs(app, nil)
	if err != nil || recs != nil {
		t.Fatalf("expected nil, nil, got %v, %v", recs, err)
	}

	// Create live fragment and soft-deleted fragment
	t1 := time.Date(2025, 1, 10, 12, 0, 0, 0, time.UTC)
	f1 := testutil.NewRecord(t, app, schema.ColFragment.String(), map[string]any{
		"type":        "email",
		"content":     "Hello world",
		"occurred_at": types.NowDateTime().Time().Format("2006-01-02 15:04:05.000Z"),
	})
	f1.Set("occurred_at", t1.Format("2006-01-02 15:04:05.000Z"))
	if err := app.Save(f1); err != nil {
		t.Fatal(err)
	}

	f2 := testutil.NewRecord(t, app, schema.ColFragment.String(), map[string]any{
		"type":       "note",
		"content":    "Deleted note",
		"deleted_at": "2025-01-11 10:00:00.000Z",
	})

	// FindFragmentByID
	rec, err := sourcedata.FindFragmentByID(app, f1.Id)
	if err != nil || rec == nil || rec.Id != f1.Id {
		t.Fatalf("FindFragmentByID failed: %v, rec: %v", err, rec)
	}

	// FindFragmentsByIDs
	multi, err := sourcedata.FindFragmentsByIDs(app, []string{f1.Id, f2.Id})
	if err != nil || len(multi) != 2 {
		t.Fatalf("FindFragmentsByIDs failed: %v, count: %d", err, len(multi))
	}

	// FindLiveFragments: only f1 is live
	live, err := sourcedata.FindLiveFragments(app, nil)
	if err != nil || len(live) != 1 || live[0].Id != f1.Id {
		t.Fatalf("FindLiveFragments expected [f1], got %v (err: %v)", live, err)
	}

	// Window filter
	win := &api.Window{Start: "2025-01-01 00:00:00.000Z", End: "2025-01-05 00:00:00.000Z"}
	inWin, err := sourcedata.FindLiveFragmentIDs(app, win)
	if err != nil || len(inWin) != 0 {
		t.Fatalf("expected 0 fragments in window, got %v", inWin)
	}

	win2 := &api.Window{Start: "2025-01-01 00:00:00.000Z", End: "2025-01-15 00:00:00.000Z"}
	inWin2, err := sourcedata.FindLiveFragmentIDs(app, win2)
	if err != nil || len(inWin2) != 1 || inWin2[0] != f1.Id {
		t.Fatalf("expected [f1] in window, got %v", inWin2)
	}

	// FragmentDates
	dates, err := sourcedata.FragmentDates(app)
	if err != nil || dates[f1.Id] != "2025-01-10" {
		t.Fatalf("FragmentDates expected '2025-01-10', got %v", dates)
	}

	// PendingAnnotationCount
	count, err := sourcedata.PendingAnnotationCount(app)
	if err != nil || count != 1 {
		t.Fatalf("PendingAnnotationCount expected 1, got %d (err: %v)", count, err)
	}

	// Add annotation
	testutil.NewRecord(t, app, schema.ColFragmentAnnotation.String(), map[string]any{
		"fragment_id": f1.Id,
		"title":       "Test Email",
		"summary":     "A summary",
	})

	countAfter, err := sourcedata.PendingAnnotationCount(app)
	if err != nil || countAfter != 0 {
		t.Fatalf("PendingAnnotationCount after annotation expected 0, got %d", countAfter)
	}
}

func TestColours(t *testing.T) {
	app := testutil.NewApp(t)

	c1 := testutil.NewRecord(t, app, schema.ColColour.String(), map[string]any{"name": "Blue", "swatch": 0})
	c2 := testutil.NewRecord(t, app, schema.ColColour.String(), map[string]any{"name": "Green", "swatch": 1})

	f1 := testutil.NewRecord(t, app, schema.ColFragment.String(), map[string]any{"type": "note", "content": "1"})
	f2 := testutil.NewRecord(t, app, schema.ColFragment.String(), map[string]any{"type": "note", "content": "2"})
	f3 := testutil.NewRecord(t, app, schema.ColFragment.String(), map[string]any{"type": "note", "content": "3"})

	// Links
	testutil.NewRecord(t, app, schema.ColColourFragment.String(), map[string]any{
		"colour_id": c1.Id, "fragment_id": f1.Id, "match_type": "manual_positive",
	})
	testutil.NewRecord(t, app, schema.ColColourFragment.String(), map[string]any{
		"colour_id": c1.Id, "fragment_id": f2.Id, "match_type": "manual_negative", // Excluded!
	})
	testutil.NewRecord(t, app, schema.ColColourFragment.String(), map[string]any{
		"colour_id": c2.Id, "fragment_id": f1.Id, "match_type": "thing",
	})
	testutil.NewRecord(t, app, schema.ColColourFragment.String(), map[string]any{
		"colour_id": c2.Id, "fragment_id": f3.Id, "match_type": "prompt",
	})

	// ColourMemberIDs for c1: f1 only (f2 is manual_negative)
	m1, err := sourcedata.ColourMemberIDs(app, c1.Id)
	if err != nil || len(m1) != 1 || m1[0] != f1.Id {
		t.Fatalf("c1 members expected [f1], got %v (err: %v)", m1, err)
	}

	// ColourMemberIDs for c1, c2: f1, f3 (deduplicated)
	mAll, err := sourcedata.ColourMemberIDs(app, c1.Id, c2.Id)
	if err != nil || len(mAll) != 2 {
		t.Fatalf("c1+c2 members expected 2 items, got %v", mAll)
	}

	// ColourMembersMap
	mMap, err := sourcedata.ColourMembersMap(app, []string{c1.Id, c2.Id})
	if err != nil {
		t.Fatalf("ColourMembersMap failed: %v", err)
	}
	if len(mMap[c1.Id]) != 1 || mMap[c1.Id][0] != f1.Id {
		t.Fatalf("expected c1 to have [f1], got %v", mMap[c1.Id])
	}
	if len(mMap[c2.Id]) != 2 {
		t.Fatalf("expected c2 to have 2 members, got %v", mMap[c2.Id])
	}

	// FindColourByID and FindAllColours
	cRec, err := sourcedata.FindColourByID(app, c1.Id)
	if err != nil || cRec.Id != c1.Id {
		t.Fatalf("FindColourByID failed: %v", err)
	}
	allCols, err := sourcedata.FindAllColours(app)
	if err != nil || len(allCols) != 2 {
		t.Fatalf("FindAllColours failed: %v", err)
	}
}

func TestMapAndAnnotations(t *testing.T) {
	app := testutil.NewApp(t)

	// LoadDocument when absent creates initial doc with version 0
	doc, version, err := sourcedata.LoadDocument(app)
	if err != nil || doc == nil || version != 0 {
		t.Fatalf("LoadDocument initial failed: %v, version: %d", err, version)
	}

	// Seed fragment and annotation
	f1 := testutil.NewRecord(t, app, schema.ColFragment.String(), map[string]any{
		"type":        "email",
		"content":     "Alpha project update",
		"occurred_at": "2025-02-01 10:00:00.000Z",
	})

	testutil.NewRecord(t, app, schema.ColFragmentAnnotation.String(), map[string]any{
		"fragment_id": f1.Id,
		"title":       "Alpha update",
		"summary":     "Status of alpha",
		"things":      `[{"ref":"t_alpha","name":"Alpha Project"}]`,
	})

	rows, err := sourcedata.LoadAnnotationRows(app)
	if err != nil || len(rows) != 1 {
		t.Fatalf("LoadAnnotationRows failed: %v, rows: %v", err, rows)
	}
	if rows[0].Date != "2025-02-01" || rows[0].Title != "Alpha update" || len(rows[0].Things) != 1 {
		t.Fatalf("unexpected row contents: %+v", rows[0])
	}

	// IndexRows
	d := &mapdoc.Document{
		Things: []mapdoc.Thing{
			{ID: "t_alpha", Name: "Alpha Project"},
		},
	}
	index := sourcedata.IndexRows(d, rows)
	if len(index["t_alpha"]) != 1 || index["t_alpha"][0] != 0 {
		t.Fatalf("IndexRows expected t_alpha to point to row 0, got %v", index)
	}

	// ResolveRef
	tRef := sourcedata.ResolveRef(d, "alpha project")
	if tRef == nil || tRef.ID != "t_alpha" {
		t.Fatalf("ResolveRef failed to resolve by name: %v", tRef)
	}

	// LoadMapIndex
	mapIdx, err := sourcedata.LoadMapIndex(app)
	if err != nil || mapIdx == nil || len(mapIdx.Rows) != 1 {
		t.Fatalf("LoadMapIndex failed: %v", err)
	}
}

func TestSnapshots(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{"name": "Summary"})
	s1 := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id":            proj.Id,
		"output":                   "Draft 1",
		"status":                   "pending_review",
		"approval_sequence_number": 0,
	})
	s2 := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id":            proj.Id,
		"output":                   "Approved 1",
		"status":                   "approved",
		"approval_sequence_number": 1,
	})
	s3 := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id":            proj.Id,
		"output":                   "Approved 2",
		"status":                   "approved",
		"approval_sequence_number": 2,
	})

	// FindSnapshotByID
	rec, err := sourcedata.FindSnapshotByID(app, schema.ColProjectionSnapshot.String(), s1.Id)
	if err != nil || rec == nil || rec.Id != s1.Id {
		t.Fatalf("FindSnapshotByID failed: %v", err)
	}

	// FindProjectionSnapshotsByIDs
	snaps, err := sourcedata.FindProjectionSnapshotsByIDs(app, []string{s1.Id, s2.Id})
	if err != nil || len(snaps) != 2 {
		t.Fatalf("FindProjectionSnapshotsByIDs failed: %v", err)
	}

	// LatestApprovedSnapshot should return s3 (approval_sequence_number = 2)
	latest, err := sourcedata.LatestApprovedSnapshot(app, schema.ColProjectionSnapshot.String(), "projection_id", proj.Id)
	if err != nil || latest == nil || latest.Id != s3.Id {
		t.Fatalf("LatestApprovedSnapshot expected s3, got %v (err: %v)", latest, err)
	}
}
