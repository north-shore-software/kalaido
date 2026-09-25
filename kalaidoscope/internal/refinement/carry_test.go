package refinement_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
	"github.com/pocketbase/pocketbase/core"
)

// carryFixture is a projection after an approve: the approved snapshot with a
// refinement still bound to it, and the fold-in's fresh pending candidate.
func carryFixture(t *testing.T, app core.App) (proj, approved, refRec, cand *core.Record) {
	t.Helper()
	proj = testutil.NewRecord(t, app, schema.ColProjection.String(), map[string]any{
		"name": "Test Projection",
	})
	approved = testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"output":                   "approved text",
		"approval_sequence_number": 1,
	})
	refRec = testutil.NewRecord(t, app, schema.ColProjectionRefinement.String(), map[string]any{
		"projection_id":            proj.Id,
		"projection_snapshot_id":   approved.Id,
		"external_conversation_id": "conv-carry",
	})
	cand = testutil.NewRecord(t, app, schema.ColProjectionSnapshot.String(), map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "approved text plus new context",
		"output_raw":    "approved text plus new context",
	})
	return proj, approved, refRec, cand
}

func boundSnapshot(t *testing.T, app core.App, refID string) string {
	t.Helper()
	rec, err := app.FindRecordById(schema.ColProjectionRefinement.String(), refID)
	if err != nil {
		t.Fatal(err)
	}
	return rec.GetString("projection_snapshot_id")
}

func TestCarryOpenRefinementMovesChatToFoldedInCandidate(t *testing.T) {
	app := testutil.NewApp(t)
	proj, _, refRec, cand := carryFixture(t, app)

	got, err := refinement.CarryOpenRefinementToCandidate(context.Background(), app, proj.Id, cand.Id)
	if err != nil {
		t.Fatalf("carry: %v", err)
	}
	if got != refRec.Id {
		t.Fatalf("carried %q, want %q", got, refRec.Id)
	}
	if bound := boundSnapshot(t, app, refRec.Id); bound != cand.Id {
		t.Fatalf("refinement bound to %q, want the candidate %q", bound, cand.Id)
	}
}

func TestCarryOpenRefinementLeavesLensDraftingChatBehind(t *testing.T) {
	app := testutil.NewApp(t)
	proj, approved, refRec, cand := carryFixture(t, app)
	data, _ := json.Marshal(prompts.LensPartData{Lens: "Summarise the week"})
	msg := api.UIMessage{
		ID:   "m-lens",
		Role: "assistant",
		Parts: []api.UIMessagePart{{
			Type: prompts.LensPartType,
			Data: data,
		}},
	}
	if _, err := chat.PersistMessage(context.Background(), app, refRec, msg, ""); err != nil {
		t.Fatal(err)
	}

	got, err := refinement.CarryOpenRefinementToCandidate(context.Background(), app, proj.Id, cand.Id)
	if err != nil {
		t.Fatalf("carry: %v", err)
	}
	if got != "" {
		t.Fatalf("carried %q, want nothing", got)
	}
	if bound := boundSnapshot(t, app, refRec.Id); bound != approved.Id {
		t.Fatalf("refinement bound to %q, want it left on %q", bound, approved.Id)
	}
}

func TestCarryOpenRefinementIgnoresSettledFoldIn(t *testing.T) {
	app := testutil.NewApp(t)
	proj, approved, refRec, _ := carryFixture(t, app)

	// A fold-in that found nothing new settles the approved row in place and
	// hands back its id: there is no candidate to carry the chat onto.
	got, err := refinement.CarryOpenRefinementToCandidate(context.Background(), app, proj.Id, approved.Id)
	if err != nil {
		t.Fatalf("carry: %v", err)
	}
	if got != "" {
		t.Fatalf("carried %q, want nothing", got)
	}
	if bound := boundSnapshot(t, app, refRec.Id); bound != approved.Id {
		t.Fatalf("refinement bound to %q, want %q", bound, approved.Id)
	}
}
