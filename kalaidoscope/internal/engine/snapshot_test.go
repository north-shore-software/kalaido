package engine

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestSnapshotCurrencyConsidersModel(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	pinned := llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt":       "LENS",
		"context_spec": pbutil.JSONObject(spec),
	})
	newProj := func(model string) *core.Record {
		return testutil.NewRecord(t, app, "projection", map[string]any{
			"name":                 "P",
			"current_context_spec": pbutil.JSONObject(spec),
			"current_lens_id":      lens.Id,
			"generate_with_model":  model,
		})
	}
	newSnap := func(projID, model string) *core.Record {
		return testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
			"projection_id":            projID,
			"status":                   StatusApproved,
			"output":                   "OUT",
			"context_spec":             pbutil.JSONObject(spec),
			"resolved_context":         pbutil.JSONObject(pinned),
			"lens_id":                  lens.Id,
			"generated_by_model":       model,
			"approval_sequence_number": 1,
		})
	}

	matchingProj := newProj("")
	matchingSnap := newSnap(matchingProj.Id, "gemma4")
	if current, reason := SnapshotCurrency(matchingProj, matchingSnap, pinned); !current {
		t.Fatalf("matching model should be current, got reason %q", reason)
	}

	driftedProj := newProj("other-model")
	driftedSnap := newSnap(driftedProj.Id, "gemma4")
	if current, reason := SnapshotCurrency(driftedProj, driftedSnap, pinned); current || reason != CurrencyModelChanged {
		t.Fatalf("drifted model = (%v, %q), want (false, %q)", current, reason, CurrencyModelChanged)
	}

	legacyProj := newProj("other-model")
	legacySnap := newSnap(legacyProj.Id, "")
	if current, reason := SnapshotCurrency(legacyProj, legacySnap, pinned); !current {
		t.Fatalf("legacy snapshot without model must stay current, got reason %q", reason)
	}
}
