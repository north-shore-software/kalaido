package engine

import (
	"context"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
)

func TestSnapshotIsCurrentConsidersModel(t *testing.T) {
	app := pbtest.NewApp(t)
	frag := pbtest.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	lens := pbtest.NewRecord(t, app, "lens", map[string]any{
		"prompt":       pbutil.JSONString("LENS"),
		"context_spec": pbutil.JSONObject(spec),
		"model":        "gemma4",
	})
	proj := pbtest.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P",
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
	})
	seq := 0
	newSnap := func(model string) {
		seq++
		pbtest.NewRecord(t, app, "projection_snapshot", map[string]any{
			"projection_id":            proj.Id,
			"status":                   StatusApproved,
			"output":                   pbutil.JSONString("OUT"),
			"context_spec":             pbutil.JSONObject(spec),
			"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
			"lens_id":                  lens.Id,
			"model":                    model,
			"approval_sequence_number": seq,
		})
	}
	ctx := context.Background()
	strat := ProjectionStrategy{}

	// Same lens, same context, matching model (gemma4 via the static local
	// set): current.
	newSnap("gemma4")
	if !SnapshotIsCurrent(ctx, app, strat, proj) {
		t.Fatal("matching model should be current")
	}

	// The entity's effective model moves away from what the snapshot was
	// generated with: no longer current.
	proj.Set("model", "other-model")
	if err := app.Save(proj); err != nil {
		t.Fatal(err)
	}
	if SnapshotIsCurrent(ctx, app, strat, proj) {
		t.Fatal("drifted model should not be current")
	}

	// A legacy snapshot with no recorded model never reads as stale on model
	// grounds alone.
	newSnap("")
	if !SnapshotIsCurrent(ctx, app, strat, proj) {
		t.Fatal("legacy snapshot without model must stay current")
	}
}
