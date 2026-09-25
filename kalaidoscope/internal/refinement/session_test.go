package refinement_test

import (
	"context"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestMaterializeCandidateDiffsAgainstApprovedSnapshot(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "Test Projection",
	})
	testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"output":                   "Paragraph 1\n\nParagraph 2\n\nParagraph 3",
		"approval_sequence_number": 1,
	})
	pendingSnap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "Old draft",
		"output_raw":    "Old raw",
	})
	refRec := testutil.NewRecord(t, app, schema.ColProjectionRefinement.String(), map[string]any{
		"projection_id":            proj.Id,
		"projection_snapshot_id":   pendingSnap.Id,
		"external_conversation_id": "conv-1",
	})

	newOutput := "Paragraph 1\n\nModified Paragraph 2\n\nParagraph 3"
	snapID, err := refinement.MaterializeCandidateIfNew(
		context.Background(),
		app,
		refRec,
		"New Lens Prompt",
		newOutput,
		llmcontext.PinnedIDs{},
		api.ContextSpec{},
		"Suggested Name",
		"mock-model",
	)
	if err != nil {
		t.Fatalf("MaterializeCandidateIfNew: %v", err)
	}
	if snapID != pendingSnap.Id {
		t.Fatalf("got snapID %q, want %q", snapID, pendingSnap.Id)
	}

	updatedSnap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), pendingSnap.Id)
	if err != nil {
		t.Fatal(err)
	}
	edits := engine.LoadSnapshotEdits(updatedSnap)
	if len(edits) == 0 {
		t.Fatal("expected diff change cards to be generated, got 0")
	}
	draft := updatedSnap.GetString("output_draft")
	if !engine.HasUnresolvedEditMarkers(draft) {
		t.Fatalf("expected markers in output_draft, got: %s", draft)
	}
	if updatedSnap.GetString("generated_by_model") != "mock-model" {
		t.Errorf("model = %q, want mock-model", updatedSnap.GetString("generated_by_model"))
	}
}

func TestCommitUsesCandidateDraftWhenChatHasNoPreviewOutput(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "Test Projection",
	})
	pendingSnap := testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "Clean Draft Content Without Markers",
		"output_raw":    "Clean Draft Content",
	})
	refRec := testutil.NewRecord(t, app, schema.ColProjectionRefinement.String(), map[string]any{
		"projection_id":            proj.Id,
		"projection_snapshot_id":   pendingSnap.Id,
		"external_conversation_id": "conv-1",
	})

	// Seed message with update_lens only (no apply_result)
	msg := api.UIMessage{
		ID:   "msg-lens-only",
		Role: "assistant",
		Parts: []api.UIMessagePart{
			{
				Type: "data-lens",
				Data: []byte(`{"lens":"Updated Lens Prompt"}`),
			},
		},
	}
	if _, err := chat.PersistMessage(context.Background(), app, refRec, msg, ""); err != nil {
		t.Fatalf("PersistMessage: %v", err)
	}

	snapID, err := refinement.Commit(context.Background(), app, refRec, proj.Id, nil, nil)
	if err != nil {
		t.Fatalf("Commit failed: %v", err)
	}
	if snapID != pendingSnap.Id {
		t.Fatalf("got snapID %q, want %q", snapID, pendingSnap.Id)
	}

	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), pendingSnap.Id)
	if err != nil {
		t.Fatal(err)
	}
	if snap.GetString("status") != engine.StatusApproved {
		t.Errorf("status = %q, want approved", snap.GetString("status"))
	}
	if snap.GetString("output") != "Clean Draft Content Without Markers" {
		t.Errorf("output = %q, want draft content", snap.GetString("output"))
	}
}
