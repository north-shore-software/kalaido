package engine

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// resolveActiveLens loads the entity's current lens — the standing instruction
// its refinement chat drafted and its commit installed (see CommitRefinement)
// — and the scope it applies to, which is the entity's own
// current_context_spec: the lens carries no copy, so a spec edit that never
// touches the lens (the colour-delete scrub) is what the next generation runs.
func resolveActiveLens(app core.App, strat Strategy, rec *core.Record) (string, api.ContextSpec) {
	var lensPrompt string
	if lensID := rec.GetString("current_lens_id"); lensID != "" {
		if lrec, err := app.FindRecordById(strat.LensCollectionName(), lensID); err == nil {
			lensPrompt = lrec.GetString("prompt")
		}
	}
	var spec api.ContextSpec
	_ = rec.UnmarshalJSONField("current_context_spec", &spec)
	return lensPrompt, spec
}
