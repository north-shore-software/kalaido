package engine

import (
	"context"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// A commit installs the drafted lens and the approved snapshot atomically:
// lens row with full provenance, snapshot pointing at it, parent re-pointed.
func TestCommitRefinementInstallsLens(t *testing.T) {
	app := testutil.NewApp(t)
	strat := ProjectionStrategy{}

	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{FragmentIDs: []string{frag.Id}}
	oldLens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": pbutil.JSONString("OLD LENS"),
	})
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":            "P",
		"current_lens_id": oldLens.Id,
	})
	ref := testutil.NewRecord(t, app, "refine_proj_snapshot_conversation", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "ext-1",
	})
	pinned := llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}

	snapID, err := CommitRefinement(context.Background(), app, strat,
		proj.Id, "", "NEW LENS", "APPROVED OUTPUT", pinned, spec, api.WindowSpec{}, ref.Id, "projection")
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	proj, err = app.FindRecordById("projection", proj.Id)
	if err != nil {
		t.Fatal(err)
	}
	lensID := proj.GetString("current_lens_id")
	if lensID == "" || lensID == oldLens.Id {
		t.Fatalf("current_lens_id = %q, want a freshly installed lens", lensID)
	}
	lens, err := app.FindRecordById("lens", lensID)
	if err != nil {
		t.Fatal(err)
	}
	if got := pbutil.DecodeJSONString(lens.GetString("prompt")); got != "NEW LENS" {
		t.Errorf("lens prompt = %q, want the drafted lens", got)
	}
	if got := lens.GetString("parent_lens_id"); got != oldLens.Id {
		t.Errorf("parent_lens_id = %q, want the superseded lens %q", got, oldLens.Id)
	}
	if got := lens.GetString("created_from_proj_refinement_id"); got != ref.Id {
		t.Errorf("created_from_proj_refinement_id = %q, want %q", got, ref.Id)
	}

	snap, err := app.FindRecordById("projection_snapshot", snapID)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("status"); got != StatusApproved {
		t.Errorf("snapshot status = %q, want approved", got)
	}
	if got := snap.GetString("lens_id"); got != lensID {
		t.Errorf("snapshot lens_id = %q, want the installed lens %q", got, lensID)
	}
	if got := pbutil.DecodeJSONString(snap.GetString("output")); got != "APPROVED OUTPUT" {
		t.Errorf("snapshot output = %q, want the applied output", got)
	}
	if got := snap.GetString("created_from_refinement_id"); got != ref.Id {
		t.Errorf("created_from_refinement_id = %q, want %q", got, ref.Id)
	}

	var gotSpec api.ContextSpec
	if err := proj.UnmarshalJSONField("current_context_spec", &gotSpec); err != nil || len(gotSpec.FragmentIDs) != 1 {
		t.Errorf("current_context_spec = %+v (err %v), want the committed spec", gotSpec, err)
	}
}

// The P0 regression (refresh-before-lens-distills): a generation immediately
// after a commit must succeed — the lens exists the moment the commit lands,
// so ErrLensNotReady is unreachable from here.
func TestGenerateSucceedsImmediatelyAfterCommit(t *testing.T) {
	app := testutil.NewApp(t)
	strat := ProjectionStrategy{}

	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{FragmentIDs: []string{frag.Id}}
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "P"})
	ref := testutil.NewRecord(t, app, "refine_proj_snapshot_conversation", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "ext-1",
	})
	pinned := llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}

	if _, err := CommitRefinement(context.Background(), app, strat,
		proj.Id, "", "NEW LENS", "APPROVED OUTPUT", pinned, spec, api.WindowSpec{}, ref.Id, "projection"); err != nil {
		t.Fatalf("commit: %v", err)
	}

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		if len(msgs) == 1 {
			return "APPROVED OUTPUT", nil // byte-identical: minimize short-circuits
		}
		return "", nil
	}}
	script.install(t)

	if _, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil); err != nil {
		t.Fatalf("generate right after commit: %v", err)
	}
}
