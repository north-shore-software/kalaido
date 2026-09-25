package projections_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

const editSourceOutput = "# T\n\nalpha beta\n\n\ngamma"

func genFixture(t *testing.T, app core.App) *core.Record {
	t.Helper()
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt":       "LENS",
		"context_spec": pbutil.JSONObject(spec),
	})
	return testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "T",
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
	})
}

func editFixture(t *testing.T, app core.App) (*core.Record, *core.Record) {
	t.Helper()
	proj := genFixture(t, app)
	frags, err := app.FindRecordsByFilter("fragment", "deleted_at = ''", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, f := range frags {
		ids = append(ids, f.Id)
	}
	var spec api.ContextSpec
	if err := proj.UnmarshalJSONField("current_context_spec", &spec); err != nil {
		t.Fatal(err)
	}
	model, err := llm.ResolveRoleFor(llm.RoleSnapshot, "")
	if err != nil {
		t.Fatal(err)
	}
	src := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":      proj.Id,
		"lens_id":            proj.GetString("current_lens_id"),
		"output":             "",
		"output_draft":       editSourceOutput,
		"status":             engine.StatusPending,
		"context_spec":       pbutil.JSONObject(spec),
		"resolved_context":   pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: ids}),
		"generated_by_model": model,
		"generation_trigger": llmcontext.TriggerGenerateAll,
	})
	return proj, src
}

func editFragments(t *testing.T, app core.App) []*core.Record {
	t.Helper()
	recs, err := app.FindRecordsByFilter("fragment", "type = {:t}", "", 0, 0, dbx.Params{"t": prompts.EditFragmentKind})
	if err != nil {
		t.Fatal(err)
	}
	return recs
}

func snapshotRows(t *testing.T, app core.App, parentID string) []*core.Record {
	t.Helper()
	recs, err := app.FindRecordsByFilter("projection_snapshot", "projection_id = {:id}", "created", 0, 0, dbx.Params{"id": parentID})
	if err != nil {
		t.Fatal(err)
	}
	return recs
}

func storedOutput(t *testing.T, app core.App, snapID string) string {
	t.Helper()
	snap, err := app.FindRecordById("projection_snapshot", snapID)
	if err != nil {
		t.Fatal(err)
	}
	return snap.GetString("output")
}

func TestApplyEditDefaultDoesNotCreateFragment(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editFixture(t, app)

	res, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, 1, "alpha BETA")
	if err != nil {
		t.Fatal(err)
	}

	if res.FragmentID != "" {
		t.Errorf("res.FragmentID = %q, want empty by default", res.FragmentID)
	}

	frags := editFragments(t, app)
	if len(frags) != 0 {
		t.Fatalf("edit fragments = %d, want 0 when disabled by default", len(frags))
	}

	proj, err = app.FindRecordById("projection", proj.Id)
	if err != nil {
		t.Fatal(err)
	}
	var parentSpec api.ContextSpec
	if err := proj.UnmarshalJSONField("current_context_spec", &parentSpec); err != nil {
		t.Fatal(err)
	}
	if len(parentSpec.FragmentIDs) != 0 {
		t.Errorf("projection current_context_spec.fragmentIds = %v, want empty", parentSpec.FragmentIDs)
	}

	rows := snapshotRows(t, app, proj.Id)
	if len(rows) != 1 {
		t.Fatalf("snapshot rows = %d, want the candidate updated in place", len(rows))
	}
	edited := rows[0]
	if edited.Id != src.Id {
		t.Errorf("edited id = %s, want %s", edited.Id, src.Id)
	}
	if got := edited.GetString("output"); got != "" {
		t.Errorf("edited output = %q, want empty", got)
	}
	wantOutput := "# T\n\nalpha BETA\n\ngamma"
	if got := edited.GetString("output_draft"); got != wantOutput {
		t.Errorf("edited output_draft = %q, want %q", got, wantOutput)
	}
	snapEdits := engine.LoadSnapshotEdits(edited)
	if len(snapEdits) != 1 || snapEdits[0].Type != api.EditTypeManual || snapEdits[0].Status != api.EditStatusApproved {
		t.Errorf("unexpected snapshot edits: %+v", snapEdits)
	}
	if snapEdits[0].FragmentID != "" {
		t.Errorf("snapshot edit fragmentId = %q, want empty", snapEdits[0].FragmentID)
	}
}

func TestApplyEditCreatesFragmentWhenEnabled(t *testing.T) {
	app := testutil.NewApp(t)
	projections.SetHandEditCreateFragment(app, true)
	proj, src := editFixture(t, app)

	res, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, 1, "alpha BETA")
	if err != nil {
		t.Fatal(err)
	}

	frags := editFragments(t, app)
	if len(frags) != 1 || frags[0].Id != res.FragmentID {
		t.Fatalf("edit fragments = %d, want exactly the one returned", len(frags))
	}
	frag := frags[0]
	content := frag.GetString("content")
	for _, want := range []string{prompts.EditBeforeMarker, prompts.EditAfterMarker, "alpha beta", "alpha BETA"} {
		if !strings.Contains(content, want) {
			t.Errorf("fragment content lacks %q:\n%s", want, content)
		}
	}
	if got := frag.GetString("ingested_via"); got != "app" {
		t.Errorf("ingested_via = %q, want app", got)
	}
	if frag.GetDateTime("occurred_at").IsZero() {
		t.Error("occurred_at not set")
	}

	proj, err = app.FindRecordById("projection", proj.Id)
	if err != nil {
		t.Fatal(err)
	}
	var parentSpec api.ContextSpec
	if err := proj.UnmarshalJSONField("current_context_spec", &parentSpec); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(parentSpec.FragmentIDs, frag.Id) {
		t.Errorf("projection current_context_spec.fragmentIds = %v, want the edit fragment pinned", parentSpec.FragmentIDs)
	}
	if parentSpec.WholeScope != api.WholeScopeFull {
		t.Errorf("whole scope mode changed to %q", parentSpec.WholeScope)
	}

	rows := snapshotRows(t, app, proj.Id)
	if len(rows) != 1 {
		t.Fatalf("snapshot rows = %d, want the candidate updated in place", len(rows))
	}
	edited := rows[0]
	if edited.Id != src.Id {
		t.Errorf("edited id = %s, want %s", edited.Id, src.Id)
	}
	if got := edited.GetString("output"); got != "" {
		t.Errorf("edited output = %q, want empty", got)
	}
	wantOutput := "# T\n\nalpha BETA\n\ngamma"
	if got := edited.GetString("output_draft"); got != wantOutput {
		t.Errorf("edited output_draft = %q, want %q", got, wantOutput)
	}
	snapEdits := engine.LoadSnapshotEdits(edited)
	if len(snapEdits) != 1 || snapEdits[0].Type != api.EditTypeManual || snapEdits[0].Status != api.EditStatusApproved {
		t.Errorf("unexpected snapshot edits: %+v", snapEdits)
	}
	if snapEdits[0].FragmentID != frag.Id {
		t.Errorf("snapshot edit fragmentId = %q, want %q", snapEdits[0].FragmentID, frag.Id)
	}
	if got := edited.GetString("status"); got != engine.StatusPending {
		t.Errorf("edited status = %q, want pending", got)
	}
	if got := edited.GetString("lens_id"); got != src.GetString("lens_id") {
		t.Errorf("lens_id = %q, want inherited %q", got, src.GetString("lens_id"))
	}
	if got := edited.GetString("generated_by_model"); got == "" || got != src.GetString("generated_by_model") {
		t.Errorf("generated_by_model = %q, want inherited %q", got, src.GetString("generated_by_model"))
	}
	if got := edited.GetString("generation_trigger"); got != src.GetString("generation_trigger") {
		t.Errorf("generation_trigger = %q, want %q", got, src.GetString("generation_trigger"))
	}
	var snapSpec api.ContextSpec
	if err := edited.UnmarshalJSONField("context_spec", &snapSpec); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(snapSpec.FragmentIDs, frag.Id) {
		t.Errorf("snapshot context_spec.fragmentIds = %v, want the edit fragment", snapSpec.FragmentIDs)
	}
	var pinned llmcontext.PinnedIDs
	if err := edited.UnmarshalJSONField("resolved_context", &pinned); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(pinned.FragmentIDs, frag.Id) || !slices.Contains(pinned.ExpandedIDs, frag.Id) {
		t.Errorf("resolved_context = %+v, want the edit fragment in FragmentIDs and ExpandedIDs", pinned)
	}
	if len(pinned.FragmentIDs) != 2 {
		t.Errorf("resolved FragmentIDs = %v, want the original note plus the edit", pinned.FragmentIDs)
	}

	if !engine.SnapshotIsCurrent(context.Background(), app, projections.Strategy{}, proj) {
		t.Error("edited candidate should read as current: it carries the new fragment the scope now resolves to")
	}
}

func TestApplyEditCreatesFragmentViaEnvVar(t *testing.T) {
	t.Setenv("KALAIDO_HAND_EDIT_CREATE_FRAGMENT", "1")
	app := testutil.NewApp(t)
	proj, src := editFixture(t, app)

	res, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, 1, "alpha BETA")
	if err != nil {
		t.Fatal(err)
	}

	if res.FragmentID == "" {
		t.Error("res.FragmentID is empty, want fragment created via env var")
	}
	frags := editFragments(t, app)
	if len(frags) != 1 || frags[0].Id != res.FragmentID {
		t.Fatalf("edit fragments = %d, want 1", len(frags))
	}
}

func TestApplyEditRejectionsLeaveNoTrace(t *testing.T) {
	cases := []struct {
		name    string
		prepare func(t *testing.T, app core.App, proj, src *core.Record) (parentID, snapID string)
		pos     int
		new     string
		want    error
	}{
		{
			name: "approved source",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) {
				src.Set("status", engine.StatusApproved)
				src.Set("approval_sequence_number", 1)
				if err := app.Save(src); err != nil {
					t.Fatal(err)
				}
				return proj.Id, src.Id
			},
			pos: 1, new: "x", want: projections.ErrEditNotPending,
		},
		{
			name:    "negative position",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) { return proj.Id, src.Id },
			pos:     -1, new: "x", want: projections.ErrInvalidBlockPosition,
		},
		{
			name:    "position out of bounds",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) { return proj.Id, src.Id },
			pos:     10, new: "x", want: projections.ErrInvalidBlockPosition,
		},
		{
			name: "position under edit marker",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) {
				src.Set("output_draft", "# T\n\n<<<edit:abc>>>\n\ngamma")
				if err := app.Save(src); err != nil {
					t.Fatal(err)
				}
				return proj.Id, src.Id
			},
			pos: 1, new: "x", want: projections.ErrEditUnderMarker,
		},
		{
			name:    "identical texts",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) { return proj.Id, src.Id },
			pos:     1, new: "alpha beta", want: projections.ErrEditNoChange,
		},
		{
			name: "another projection's candidate",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) {
				other := genFixture(t, app)
				return other.Id, src.Id
			},
			pos: 1, new: "x", want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			proj, src := editFixture(t, app)
			before := len(snapshotRows(t, app, proj.Id))
			specBefore := proj.GetString("current_context_spec")
			parentID, snapID := tc.prepare(t, app, proj, src)

			_, err := projections.ApplyEdit(context.Background(), app, parentID, snapID, tc.pos, tc.new)
			if err == nil {
				t.Fatal("expected an error")
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
			if tc.want != nil && !errors.Is(err, projections.ErrEditRejected) {
				t.Errorf("err = %v, want it wrapped in ErrEditRejected", err)
			}
			if n := len(editFragments(t, app)); n != 0 {
				t.Errorf("edit fragments = %d after a rejected edit", n)
			}
			if n := len(snapshotRows(t, app, proj.Id)); n != before {
				t.Errorf("snapshot rows = %d, want unchanged %d", n, before)
			}
			after, err := app.FindRecordById("projection", proj.Id)
			if err != nil {
				t.Fatal(err)
			}
			if got := after.GetString("current_context_spec"); got != specBefore {
				t.Errorf("current_context_spec changed: %s -> %s", specBefore, got)
			}
		})
	}
}

func TestApplyEditCanDeleteAPassage(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editFixture(t, app)
	_, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.ApproveSnapshot(context.Background(), app, projections.Strategy{}, src.Id); err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, src.Id); got != "# T\n\ngamma" {
		t.Errorf("output = %q", got)
	}
}

func TestApproveEditedCandidate(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editFixture(t, app)
	_, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, 1, "alpha BETA")
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.ApproveSnapshot(context.Background(), app, projections.Strategy{}, src.Id); err != nil {
		t.Fatal(err)
	}
	snap, err := app.FindRecordById("projection_snapshot", src.Id)
	if err != nil {
		t.Fatal(err)
	}
	if snap.GetString("status") != engine.StatusApproved || snap.GetInt("approval_sequence_number") != 1 {
		t.Errorf("status=%q seq=%d, want approved #1", snap.GetString("status"), snap.GetInt("approval_sequence_number"))
	}
	if got := snap.GetString("output"); got != "# T\n\nalpha BETA\n\ngamma" {
		t.Errorf("output = %q", got)
	}
}

func TestUpdateSnapshotEditStatus(t *testing.T) {
	t.Run("accept replaces marker with ContentAfter", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		editID := "edit-1"
		marker := engine.FormatEditMarker(editID)
		src.Set("output_draft", "# T\n\n"+marker+"\n\ngamma")
		edits := []api.SnapshotEdit{
			{
				ID:            editID,
				Sequence:      1,
				Type:          api.EditTypeRegeneration,
				Status:        api.EditStatusProposed,
				ContentBefore: "alpha beta",
				ContentAfter:  "alpha NEW",
				BlockIndex:    1,
			},
		}
		src.Set("edits", pbutil.JSONObject(edits))
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		res, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusApproved)
		if err != nil {
			t.Fatal(err)
		}
		if res.Status != api.EditStatusApproved {
			t.Errorf("res.Status = %s, want approved", res.Status)
		}

		snap, err := app.FindRecordById("projection_snapshot", src.Id)
		if err != nil {
			t.Fatal(err)
		}
		wantDraft := "# T\n\nalpha NEW\n\ngamma"
		if got := snap.GetString("output_draft"); got != wantDraft {
			t.Errorf("output_draft = %q, want %q", got, wantDraft)
		}
		loadedEdits := engine.LoadSnapshotEdits(snap)
		if len(loadedEdits) != 1 || loadedEdits[0].Status != api.EditStatusApproved {
			t.Errorf("edits = %+v", loadedEdits)
		}

		_, err = projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusRejected)
		if !errors.Is(err, projections.ErrEditAlreadyResolved) {
			t.Errorf("err = %v, want ErrEditAlreadyResolved", err)
		}

		undoRes, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusProposed)
		if err != nil {
			t.Fatalf("undo failed: %v", err)
		}
		if undoRes.Status != api.EditStatusProposed {
			t.Errorf("undoRes.Status = %s, want proposed", undoRes.Status)
		}
		snapAfterUndo, _ := app.FindRecordById("projection_snapshot", src.Id)
		if got := snapAfterUndo.GetString("output_draft"); got != "# T\n\n"+marker+"\n\ngamma" {
			t.Errorf("output_draft after undo = %q, want marker restored", got)
		}
	})

	t.Run("reject replaces marker with ContentBefore", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		editID := "edit-2"
		marker := engine.FormatEditMarker(editID)
		src.Set("output_draft", "# T\n\n"+marker+"\n\ngamma")
		edits := []api.SnapshotEdit{
			{
				ID:            editID,
				Sequence:      1,
				Type:          api.EditTypeRegeneration,
				Status:        api.EditStatusProposed,
				ContentBefore: "alpha beta",
				ContentAfter:  "alpha NEW",
				BlockIndex:    1,
			},
		}
		src.Set("edits", pbutil.JSONObject(edits))
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		res, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusRejected)
		if err != nil {
			t.Fatal(err)
		}
		if res.Status != api.EditStatusRejected {
			t.Errorf("res.Status = %s, want rejected", res.Status)
		}

		snap, err := app.FindRecordById("projection_snapshot", src.Id)
		if err != nil {
			t.Fatal(err)
		}
		wantDraft := "# T\n\nalpha beta\n\ngamma"
		if got := snap.GetString("output_draft"); got != wantDraft {
			t.Errorf("output_draft = %q, want %q", got, wantDraft)
		}

		undoRes, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusProposed)
		if err != nil {
			t.Fatalf("undo failed: %v", err)
		}
		if undoRes.Status != api.EditStatusProposed {
			t.Errorf("undoRes.Status = %s, want proposed", undoRes.Status)
		}
		snapAfterUndo, _ := app.FindRecordById("projection_snapshot", src.Id)
		if got := snapAfterUndo.GetString("output_draft"); got != "# T\n\n"+marker+"\n\ngamma" {
			t.Errorf("output_draft after undo = %q, want marker restored", got)
		}
	})

	t.Run("rejected pure insertion undo and latching", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		editID := "insert-1"
		marker := engine.FormatEditMarker(editID)
		src.Set("output_draft", "# T\n\n"+marker+"\n\ngamma")
		edits := []api.SnapshotEdit{
			{
				ID:            editID,
				Sequence:      1,
				Type:          api.EditTypeRefinement,
				Status:        api.EditStatusProposed,
				ContentBefore: "",
				ContentAfter:  "inserted content",
				BlockIndex:    1,
			},
		}
		src.Set("edits", pbutil.JSONObject(edits))
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		res, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusRejected)
		if err != nil {
			t.Fatal(err)
		}
		if res.InlinedText != "" || res.AnchorPrev != "# T" || res.AnchorNext != "gamma" {
			t.Errorf("unexpected anchors: %+v", res)
		}

		snap, _ := app.FindRecordById("projection_snapshot", src.Id)
		if got := snap.GetString("output_draft"); got != "# T\n\ngamma" {
			t.Errorf("output_draft after reject = %q, want '# T\\n\\ngamma'", got)
		}

		undoRes, err := projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusProposed)
		if err != nil {
			t.Fatalf("undo rejected insertion failed: %v", err)
		}
		if undoRes.Status != api.EditStatusProposed {
			t.Errorf("undoRes.Status = %s, want proposed", undoRes.Status)
		}
		snapAfterUndo, _ := app.FindRecordById("projection_snapshot", src.Id)
		if got := snapAfterUndo.GetString("output_draft"); got != "# T\n\n"+marker+"\n\ngamma" {
			t.Errorf("output_draft after undo = %q, want marker restored", got)
		}

		_, err = projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusApproved)
		if err != nil {
			t.Fatal(err)
		}

		_, err = projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, 1, "hand edited")
		if err != nil {
			t.Fatal(err)
		}

		snapLatched, _ := app.FindRecordById("projection_snapshot", src.Id)
		latchedEdits := engine.LoadSnapshotEdits(snapLatched)
		if len(latchedEdits) < 2 {
			t.Fatalf("expected at least 2 edits, got %d", len(latchedEdits))
		}
		if latchedEdits[0].Undoable == nil || *latchedEdits[0].Undoable != false || latchedEdits[0].UndoReason != "another edit was made on top" {
			t.Errorf("expected latched false with reason, got: %+v", latchedEdits[0])
		}

		_, err = projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, editID, api.EditStatusProposed)
		if !errors.Is(err, projections.ErrEditNotUndoable) {
			t.Errorf("err = %v, want ErrEditNotUndoable", err)
		}
	})
}

func TestProposeRefineEditSubBlock(t *testing.T) {
	t.Run("one sentence inside a paragraph", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		src.Set("output_draft", "Sentence one. Sentence two. Sentence three.")
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		res, err := projections.ProposeRefineEdit(context.Background(), app, proj.Id, src.Id, "Sentence two.", "Revised two.")
		if err != nil {
			t.Fatalf("ProposeRefineEdit: %v", err)
		}
		if res.Edit.ContentBefore != "Sentence two." {
			t.Errorf("ContentBefore = %q, want %q", res.Edit.ContentBefore, "Sentence two.")
		}
		if res.Edit.ContentAfter != "Revised two." {
			t.Errorf("ContentAfter = %q, want %q", res.Edit.ContentAfter, "Revised two.")
		}
		if res.Edit.BlockIndex != 0 {
			t.Errorf("BlockIndex = %d, want 0", res.Edit.BlockIndex)
		}

		snap, err := app.FindRecordById("projection_snapshot", src.Id)
		if err != nil {
			t.Fatal(err)
		}
		marker := engine.FormatEditMarker(res.Edit.ID)
		wantDraft := "Sentence one. " + marker + " Sentence three."
		if got := snap.GetString("output_draft"); got != wantDraft {
			t.Errorf("output_draft = %q, want %q", got, wantDraft)
		}

		_, err = projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, res.Edit.ID, api.EditStatusApproved)
		if err != nil {
			t.Fatalf("UpdateSnapshotEditStatus approved: %v", err)
		}
		snapApproved, _ := app.FindRecordById("projection_snapshot", src.Id)
		if got := snapApproved.GetString("output_draft"); got != "Sentence one. Revised two. Sentence three." {
			t.Errorf("output_draft after approve = %q, want %q", got, "Sentence one. Revised two. Sentence three.")
		}
	})

	t.Run("heading line joined to paragraph by single newline", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		src.Set("output_draft", "# Heading\nFirst line of body.")
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		res, err := projections.ProposeRefineEdit(context.Background(), app, proj.Id, src.Id, "# Heading", "# New Heading")
		if err != nil {
			t.Fatalf("ProposeRefineEdit: %v", err)
		}
		if res.Edit.ContentBefore != "# Heading" {
			t.Errorf("ContentBefore = %q, want %q", res.Edit.ContentBefore, "# Heading")
		}
		if res.Edit.BlockIndex != 0 {
			t.Errorf("BlockIndex = %d, want 0", res.Edit.BlockIndex)
		}

		snap, err := app.FindRecordById("projection_snapshot", src.Id)
		if err != nil {
			t.Fatal(err)
		}
		marker := engine.FormatEditMarker(res.Edit.ID)
		wantDraft := marker + "\nFirst line of body."
		if got := snap.GetString("output_draft"); got != wantDraft {
			t.Errorf("output_draft = %q, want %q", got, wantDraft)
		}

		_, err = projections.UpdateSnapshotEditStatus(context.Background(), app, proj.Id, src.Id, res.Edit.ID, api.EditStatusApproved)
		if err != nil {
			t.Fatalf("UpdateSnapshotEditStatus approved: %v", err)
		}
		snapApproved, _ := app.FindRecordById("projection_snapshot", src.Id)
		if got := snapApproved.GetString("output_draft"); got != "# New Heading\nFirst line of body." {
			t.Errorf("output_draft after approve = %q, want %q", got, "# New Heading\nFirst line of body.")
		}
	})

	t.Run("same sentence in two blocks", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		src.Set("output_draft", "First block. Common sentence.\n\nSecond block. Common sentence.")
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		res, err := projections.ProposeRefineEdit(context.Background(), app, proj.Id, src.Id, "Common sentence.", "Replaced sentence.")
		if err != nil {
			t.Fatalf("ProposeRefineEdit: %v", err)
		}
		if res.Edit.BlockIndex != 0 {
			t.Errorf("BlockIndex = %d, want 0", res.Edit.BlockIndex)
		}

		snap, err := app.FindRecordById("projection_snapshot", src.Id)
		if err != nil {
			t.Fatal(err)
		}
		marker := engine.FormatEditMarker(res.Edit.ID)
		wantDraft := "First block. " + marker + "\n\nSecond block. Common sentence."
		if got := snap.GetString("output_draft"); got != wantDraft {
			t.Errorf("output_draft = %q, want %q", got, wantDraft)
		}
	})

	t.Run("containing block with existing marker is rejected", func(t *testing.T) {
		app := testutil.NewApp(t)
		proj, src := editFixture(t, app)
		existingMarker := engine.FormatEditMarker("existing-edit")
		src.Set("output_draft", "Sentence one. "+existingMarker+" Sentence three.")
		if err := app.Save(src); err != nil {
			t.Fatal(err)
		}

		_, err := projections.ProposeRefineEdit(context.Background(), app, proj.Id, src.Id, "Sentence three.", "Revised three.")
		if !errors.Is(err, projections.ErrEditUnderMarker) {
			t.Errorf("err = %v, want ErrEditUnderMarker", err)
		}
	})
}
