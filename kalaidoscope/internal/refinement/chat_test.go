package refinement_test

import (
	"context"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestResolveNoticeEditID(t *testing.T) {
	edits := []api.SnapshotEdit{
		{ID: "e1", Status: api.EditStatusSuperseded, SupersededBy: "e2"},
		{ID: "e2", Status: api.EditStatusSuperseded, SupersededBy: "e3"},
		{ID: "e3", Status: api.EditStatusProposed},
		{ID: "e4", Status: api.EditStatusApproved},
		{ID: "e5", Status: api.EditStatusRejected},
		{ID: "e6", Status: api.EditStatusSuperseded},
		{ID: "cycle1", Status: api.EditStatusSuperseded, SupersededBy: "cycle2"},
		{ID: "cycle2", Status: api.EditStatusSuperseded, SupersededBy: "cycle1"},
	}

	if got := refinement.ResolveNoticeEditID(edits, ""); got != "" {
		t.Errorf("empty notice id: got %q, want empty", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "e3"); got != "e3" {
		t.Errorf("proposed edit: got %q, want e3", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "e1"); got != "e3" {
		t.Errorf("chained superseded edit: got %q, want e3", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "e2"); got != "e3" {
		t.Errorf("single hop superseded edit: got %q, want e3", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "e4"); got != "" {
		t.Errorf("approved edit: got %q, want empty", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "e5"); got != "" {
		t.Errorf("rejected edit: got %q, want empty", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "e6"); got != "" {
		t.Errorf("superseded without live proposal: got %q, want empty", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "cycle1"); got != "" {
		t.Errorf("cycle: got %q, want empty", got)
	}
	if got := refinement.ResolveNoticeEditID(edits, "nonexistent"); got != "" {
		t.Errorf("nonexistent: got %q, want empty", got)
	}
}

func TestReviseTwiceInARowWithOneNotice(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "P",
	})
	marker := engine.FormatEditMarker("e1")
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "# T\n\n" + marker + "\n\ngamma",
		"output_raw":    "# T\n\nalpha\n\ngamma",
		"edits": pbutil.JSONObject([]api.SnapshotEdit{
			{
				ID:            "e1",
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusProposed,
				ContentBefore: "alpha",
				ContentAfter:  "first revision",
				BlockIndex:    1,
			},
		}),
	})

	noticeID := "e1"

	snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	edits := engine.LoadSnapshotEdits(snapRec)
	targetID := refinement.ResolveNoticeEditID(edits, noticeID)
	if targetID != "e1" {
		t.Fatalf("first resolve: got %q, want e1", targetID)
	}

	res1, err := projections.ReviseProposalEdit(context.Background(), app, proj.Id, snap.Id, targetID, "second revision")
	if err != nil {
		t.Fatalf("ReviseProposalEdit 1: %v", err)
	}
	e2ID := res1.Edit.ID

	snapRec, err = app.FindRecordById(schema.ColProjectionSnapshot.String(), snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	edits = engine.LoadSnapshotEdits(snapRec)
	targetID = refinement.ResolveNoticeEditID(edits, noticeID)
	if targetID != e2ID {
		t.Fatalf("second resolve using same notice: got %q, want %q", targetID, e2ID)
	}

	res2, err := projections.ReviseProposalEdit(context.Background(), app, proj.Id, snap.Id, targetID, "third revision")
	if err != nil {
		t.Fatalf("ReviseProposalEdit 2: %v", err)
	}
	e3ID := res2.Edit.ID

	snapRec, err = app.FindRecordById(schema.ColProjectionSnapshot.String(), snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	edits = engine.LoadSnapshotEdits(snapRec)
	targetID = refinement.ResolveNoticeEditID(edits, noticeID)
	if targetID != e3ID {
		t.Fatalf("third resolve using same notice: got %q, want %q", targetID, e3ID)
	}

	lookup := make(map[string]api.SnapshotEdit)
	for _, e := range edits {
		lookup[e.ID] = e
	}
	if lookup["e1"].SupersededBy != e2ID {
		t.Errorf("e1.SupersededBy = %q, want %q", lookup["e1"].SupersededBy, e2ID)
	}
	if lookup[e2ID].SupersededBy != e3ID {
		t.Errorf("e2.SupersededBy = %q, want %q", lookup[e2ID].SupersededBy, e3ID)
	}
	if lookup[e3ID].Status != api.EditStatusProposed {
		t.Errorf("e3.Status = %s, want proposed", lookup[e3ID].Status)
	}
}

func TestAcceptThenTextTarget(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "P",
	})
	marker := engine.FormatEditMarker("e1")
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "# T\n\n" + marker + "\n\ngamma",
		"output_raw":    "# T\n\nalpha\n\ngamma",
		"edits": pbutil.JSONObject([]api.SnapshotEdit{
			{
				ID:            "e1",
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusProposed,
				ContentBefore: "alpha",
				ContentAfter:  "accepted alpha",
				BlockIndex:    1,
			},
		}),
	})

	if _, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, snap.Id, "e1", api.EditStatusApproved); err != nil {
		t.Fatalf("UpdateSnapshotEditStatus: %v", err)
	}

	noticeID := "e1"

	snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	edits := engine.LoadSnapshotEdits(snapRec)
	targetID := refinement.ResolveNoticeEditID(edits, noticeID)
	if targetID != "" {
		t.Fatalf("expected approved edit to resolve to empty, got %q", targetID)
	}

	res, err := projections.ProposeRefineEdit(context.Background(), app, proj.Id, snap.Id, "gamma", "delta")
	if err != nil {
		t.Fatalf("ProposeRefineEdit: %v", err)
	}
	if res.Edit.ContentBefore != "gamma" || res.Edit.ContentAfter != "delta" {
		t.Errorf("unexpected edit content: %+v", res.Edit)
	}
}

func TestNoticeNamingRegenerateSupersededEdit(t *testing.T) {
	app := testutil.NewApp(t)

	undoableFalse := false
	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "P",
	})
	snap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "# T\n\nfresh output\n\ngamma",
		"output_raw":    "# T\n\nfresh output\n\ngamma",
		"edits": pbutil.JSONObject([]api.SnapshotEdit{
			{
				ID:            "old-e1",
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusSuperseded,
				UndoReason:    "regenerated",
				Undoable:      &undoableFalse,
				ContentBefore: "alpha",
				ContentAfter:  "beta",
				BlockIndex:    1,
			},
		}),
	})

	noticeID := "old-e1"

	snapRec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	edits := engine.LoadSnapshotEdits(snapRec)
	targetID := refinement.ResolveNoticeEditID(edits, noticeID)
	if targetID != "" {
		t.Fatalf("expected regenerated superseded edit to resolve to empty, got %q", targetID)
	}

	res, err := projections.ProposeRefineEdit(context.Background(), app, proj.Id, snap.Id, "gamma", "delta")
	if err != nil {
		t.Fatalf("ProposeRefineEdit: %v", err)
	}
	if res.Edit.ContentBefore != "gamma" || res.Edit.ContentAfter != "delta" {
		t.Errorf("unexpected edit content: %+v", res.Edit)
	}
}
