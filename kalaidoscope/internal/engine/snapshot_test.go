package engine

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestSnapshotIsCurrentConsidersModel(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt":       pbutil.JSONString("LENS"),
		"context_spec": pbutil.JSONObject(spec),
		"model":        "gemma4",
	})
	newProj := func(model string) *core.Record {
		return testutil.NewRecord(t, app, "projection", map[string]any{
			"name":                 "P",
			"current_context_spec": pbutil.JSONObject(spec),
			"current_lens_id":      lens.Id,
			"model":                model,
		})
	}
	newSnap := func(projID, model string) {
		testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
			"projection_id":            projID,
			"status":                   StatusApproved,
			"output":                   pbutil.JSONString("OUT"),
			"context_spec":             pbutil.JSONObject(spec),
			"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
			"lens_id":                  lens.Id,
			"model":                    model,
			"approval_sequence_number": 1,
		})
	}
	ctx := context.Background()
	strat := ProjectionStrategy{}

	matchingProj := newProj("")
	newSnap(matchingProj.Id, "gemma4")
	if !SnapshotIsCurrent(ctx, app, strat, matchingProj) {
		t.Fatal("matching model should be current")
	}

	driftedProj := newProj("other-model")
	newSnap(driftedProj.Id, "gemma4")
	if SnapshotIsCurrent(ctx, app, strat, driftedProj) {
		t.Fatal("drifted model should not be current")
	}

	legacyProj := newProj("other-model")
	newSnap(legacyProj.Id, "")
	if !SnapshotIsCurrent(ctx, app, strat, legacyProj) {
		t.Fatal("legacy snapshot without model must stay current")
	}
}
