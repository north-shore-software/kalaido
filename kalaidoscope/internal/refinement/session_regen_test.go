package refinement_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/pocketbase/core"
)

// regenFixture is a projection with one pending candidate and a refinement
// attached to it; no approved snapshot exists, as for a first draft.
func regenFixture(t *testing.T, app core.App, draft string, edits []api.SnapshotEdit) (*core.Record, *core.Record) {
	t.Helper()
	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "Test Projection",
	})
	raw, _ := json.Marshal(edits)
	pending := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  draft,
		"output_raw":    draft,
		"edits":         string(raw),
	})
	refRec := testutil.NewRecord(t, app, schema.ColProjectionRefinement.String(), map[string]any{
		"projection_id":            proj.Id,
		"projection_snapshot_id":   pending.Id,
		"external_conversation_id": "conv-regen",
	})
	return pending, refRec
}

func regenerate(t *testing.T, app core.App, refRec *core.Record, output string) *core.Record {
	t.Helper()
	snapID, err := refinement.MaterializeCandidateIfNew(context.Background(), app, refRec, "Lens", output, llmcontext.PinnedIDs{}, api.ContextSpec{}, "", "mock-model")
	if err != nil {
		t.Fatalf("MaterializeCandidateIfNew: %v", err)
	}
	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
	if err != nil {
		t.Fatal(err)
	}
	return snap
}

func supersededNotice(t *testing.T, app core.App, refRec *core.Record) (prompts.RegenerateSupersededData, string, bool) {
	t.Helper()
	msgs, err := chat.LoadMessages(context.Background(), app, refRec)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range msgs {
		for _, p := range m.Parts {
			if p.Type == prompts.RegenerateSupersededPartType {
				var d prompts.RegenerateSupersededData
				_ = json.Unmarshal(p.Data, &d)
				return d, p.Text, true
			}
		}
	}
	return prompts.RegenerateSupersededData{}, "", false
}

// A first draft has no approved output to diff against, but the user has
// been looking at the candidate draft: the regeneration lands as deltas on
// that, not as a wholesale replacement.
func TestMaterializeCandidateDiffsFirstDraftAgainstItself(t *testing.T) {
	app := testutil.NewApp(t)
	_, refRec := regenFixture(t, app, "A\n\nB\n\nC", nil)

	snap := regenerate(t, app, refRec, "A\n\nB2\n\nC")

	edits := engine.LoadSnapshotEdits(snap)
	if len(edits) != 1 {
		t.Fatalf("edits = %d, want 1: %+v", len(edits), edits)
	}
	if edits[0].ContentBefore != "B" || edits[0].ContentAfter != "B2" || edits[0].Status != api.EditStatusProposed {
		t.Fatalf("edit = %+v", edits[0])
	}
	draft := snap.GetString("output_draft")
	if !strings.HasPrefix(draft, "A\n\n") || !strings.HasSuffix(draft, "\n\nC") || !strings.Contains(draft, engine.FormatEditMarker(edits[0].ID)) {
		t.Fatalf("draft = %q", draft)
	}
	if snap.GetString("output_raw") != "A\n\nB2\n\nC" {
		t.Errorf("output_raw = %q", snap.GetString("output_raw"))
	}
	if _, _, ok := supersededNotice(t, app, refRec); ok {
		t.Error("no prior edits, so no superseded notice expected")
	}
}

// An undecided proposal counts as its original passage in the baseline, and
// is superseded by the regeneration whatever the new text says there.
func TestMaterializeCandidateResolvesPendingProposalToOriginal(t *testing.T) {
	app := testutil.NewApp(t)
	pendingEdit := api.SnapshotEdit{
		ID: "e1", Sequence: 1, Type: api.EditTypeRefinement, Status: api.EditStatusProposed,
		ContentBefore: "B", ContentAfter: "Bx", BlockIndex: 1,
	}
	_, refRec := regenFixture(t, app, "A\n\n"+engine.FormatEditMarker("e1")+"\n\nC", []api.SnapshotEdit{pendingEdit})

	snap := regenerate(t, app, refRec, "A\n\nB\n\nC")

	if got := snap.GetString("output_draft"); got != "A\n\nB\n\nC" {
		t.Fatalf("draft = %q, want the baseline unchanged", got)
	}
	edits := engine.LoadSnapshotEdits(snap)
	if len(edits) != 1 {
		t.Fatalf("edits = %+v", edits)
	}
	if edits[0].Status != api.EditStatusSuperseded || edits[0].UndoReason != "regenerated" || edits[0].Undoable == nil || *edits[0].Undoable {
		t.Fatalf("pending proposal not superseded: %+v", edits[0])
	}
	d, text, ok := supersededNotice(t, app, refRec)
	if !ok || len(d.Sequences) != 1 || d.Sequences[0] != 1 || len(d.Kept) != 0 {
		t.Fatalf("notice = %+v (%v)", d, ok)
	}
	if !strings.Contains(text, "#1") {
		t.Errorf("notice text = %q", text)
	}
}

// An accepted edit whose passage the regenerated text still carries stays
// accepted, re-anchored to the block where the passage now sits.
func TestMaterializeCandidateKeepsAcceptedEditThatSurvives(t *testing.T) {
	app := testutil.NewApp(t)
	yes := true
	accepted := api.SnapshotEdit{
		ID: "e1", Sequence: 1, Type: api.EditTypeRefinement, Status: api.EditStatusApproved,
		ContentBefore: "B", ContentAfter: "B2", InlinedText: "B2", BlockIndex: 1, Undoable: &yes,
	}
	_, refRec := regenFixture(t, app, "A\n\nB2\n\nC", []api.SnapshotEdit{accepted})

	snap := regenerate(t, app, refRec, "A0\n\nB2\n\nC")

	edits := engine.LoadSnapshotEdits(snap)
	if len(edits) != 2 {
		t.Fatalf("edits = %+v", edits)
	}
	kept := edits[0]
	if kept.ID != "e1" || kept.Status != api.EditStatusApproved || kept.Undoable == nil || !*kept.Undoable || kept.UndoReason != "" {
		t.Fatalf("accepted edit did not survive: %+v", kept)
	}
	if kept.BlockIndex != 1 {
		t.Errorf("BlockIndex = %d, want 1", kept.BlockIndex)
	}
	fresh := edits[1]
	if fresh.Sequence != 2 || fresh.ContentBefore != "A" || fresh.ContentAfter != "A0" {
		t.Fatalf("regeneration edit = %+v", fresh)
	}
	d, text, ok := supersededNotice(t, app, refRec)
	if !ok || len(d.Sequences) != 0 || len(d.Kept) != 1 || d.Kept[0] != 1 {
		t.Fatalf("notice = %+v (%v)", d, ok)
	}
	if !strings.Contains(text, "still stand") {
		t.Errorf("notice text = %q", text)
	}
}

// An accepted edit whose passage the regeneration rewrote is superseded like
// any other, and the rewrite is proposed against the accepted text.
func TestMaterializeCandidateSupersedesAcceptedEditThatWasRewritten(t *testing.T) {
	app := testutil.NewApp(t)
	yes := true
	accepted := api.SnapshotEdit{
		ID: "e1", Sequence: 1, Type: api.EditTypeRefinement, Status: api.EditStatusApproved,
		ContentBefore: "B", ContentAfter: "B2", InlinedText: "B2", BlockIndex: 1, Undoable: &yes,
	}
	_, refRec := regenFixture(t, app, "A\n\nB2\n\nC", []api.SnapshotEdit{accepted})

	snap := regenerate(t, app, refRec, "A\n\nB3\n\nC")

	edits := engine.LoadSnapshotEdits(snap)
	if len(edits) != 2 {
		t.Fatalf("edits = %+v", edits)
	}
	if edits[0].Status != api.EditStatusSuperseded || edits[0].UndoReason != "regenerated" {
		t.Fatalf("accepted edit should be superseded: %+v", edits[0])
	}
	if edits[1].ContentBefore != "B2" || edits[1].ContentAfter != "B3" {
		t.Fatalf("regeneration edit should diff against the accepted text: %+v", edits[1])
	}
	d, _, ok := supersededNotice(t, app, refRec)
	if !ok || len(d.Sequences) != 1 || d.Sequences[0] != 1 || len(d.Kept) != 0 {
		t.Fatalf("notice = %+v (%v)", d, ok)
	}
}

// An edit already superseded by a revision is not reported again.
func TestMaterializeCandidateNoticeSkipsAlreadySupersededEdits(t *testing.T) {
	app := testutil.NewApp(t)
	old := api.SnapshotEdit{
		ID: "e1", Sequence: 1, Type: api.EditTypeRefinement, Status: api.EditStatusSuperseded,
		ContentBefore: "B", ContentAfter: "Bx", SupersededBy: "e2",
	}
	current := api.SnapshotEdit{
		ID: "e2", Sequence: 2, Type: api.EditTypeRefinement, Status: api.EditStatusProposed,
		ContentBefore: "B", ContentAfter: "By", BlockIndex: 1,
	}
	_, refRec := regenFixture(t, app, "A\n\n"+engine.FormatEditMarker("e2")+"\n\nC", []api.SnapshotEdit{old, current})

	regenerate(t, app, refRec, "A\n\nB\n\nC")

	d, _, ok := supersededNotice(t, app, refRec)
	if !ok || len(d.Sequences) != 1 || d.Sequences[0] != 2 {
		t.Fatalf("notice = %+v (%v)", d, ok)
	}
}
