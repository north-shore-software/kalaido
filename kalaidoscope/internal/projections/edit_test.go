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
		"output":             editSourceOutput,
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

func TestApplyEditCreatesFragmentPinsAndSecondPendingRow(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editFixture(t, app)

	res, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, "alpha beta", "alpha BETA")
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
	if len(rows) != 2 {
		t.Fatalf("snapshot rows = %d, want the source and the edited candidate", len(rows))
	}
	var edited *core.Record
	for _, r := range rows {
		if r.Id == res.SnapshotID {
			edited = r
		} else if r.Id != src.Id || r.GetString("status") != engine.StatusPending {
			t.Errorf("source row %s status = %q, want still pending", r.Id, r.GetString("status"))
		}
	}
	if edited == nil {
		t.Fatal("edited snapshot not found")
	}
	if got := edited.GetString("output"); got != "# T\n\nalpha BETA\n\n\ngamma" {
		t.Errorf("edited output = %q", got)
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
	if got := edited.GetString("generation_trigger"); got != "" {
		t.Errorf("generation_trigger = %q, want empty (not part of a wave)", got)
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

func TestApplyEditRejectionsLeaveNoTrace(t *testing.T) {
	cases := []struct {
		name    string
		prepare func(t *testing.T, app core.App, proj, src *core.Record) (parentID, snapID string)
		old     string
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
			old: "alpha beta", new: "x", want: projections.ErrEditNotPending,
		},
		{
			name:    "unknown text",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) { return proj.Id, src.Id },
			old:     "never there", new: "x", want: projections.ErrEditTextNotFound,
		},
		{
			name:    "identical texts",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) { return proj.Id, src.Id },
			old:     "alpha beta", new: "alpha beta", want: projections.ErrEditNoChange,
		},
		{
			name: "duplicated passage",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) {
				src.Set("output", "gamma\n\ngamma")
				if err := app.Save(src); err != nil {
					t.Fatal(err)
				}
				return proj.Id, src.Id
			},
			old: "gamma", new: "delta", want: projections.ErrEditTextAmbiguous,
		},
		{
			name:    "deleting everything",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) { return proj.Id, src.Id },
			old:     editSourceOutput, new: "  \n", want: projections.ErrEditEmptyResult,
		},
		{
			name: "another projection's candidate",
			prepare: func(t *testing.T, app core.App, proj, src *core.Record) (string, string) {
				other := genFixture(t, app)
				return other.Id, src.Id
			},
			old: "alpha beta", new: "x", want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			proj, src := editFixture(t, app)
			before := len(snapshotRows(t, app, proj.Id))
			specBefore := proj.GetString("current_context_spec")
			parentID, snapID := tc.prepare(t, app, proj, src)

			_, err := projections.ApplyEdit(context.Background(), app, parentID, snapID, tc.old, tc.new)
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
	res, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, "alpha beta\n\n\n", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, res.SnapshotID); got != "# T\n\ngamma" {
		t.Errorf("output = %q", got)
	}
}

func TestApproveEditedCandidateDiscardsSource(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editFixture(t, app)
	res, err := projections.ApplyEdit(context.Background(), app, proj.Id, src.Id, "alpha beta", "alpha BETA")
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.ApproveSnapshot(context.Background(), app, projections.Strategy{}, res.SnapshotID); err != nil {
		t.Fatal(err)
	}
	for _, r := range snapshotRows(t, app, proj.Id) {
		switch r.Id {
		case res.SnapshotID:
			if r.GetString("status") != engine.StatusApproved || r.GetInt("approval_sequence_number") != 1 {
				t.Errorf("edited row status=%q seq=%d, want approved #1", r.GetString("status"), r.GetInt("approval_sequence_number"))
			}
		case src.Id:
			if r.GetString("status") != engine.StatusDiscarded {
				t.Errorf("source row status = %q, want discarded", r.GetString("status"))
			}
		}
	}
}
