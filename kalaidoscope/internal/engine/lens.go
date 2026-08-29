package engine

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// resolveActiveLens loads the entity's current lens — the standing instruction
// its refinement chat drafted and its commit installed (see CommitRefinement).
func resolveActiveLens(app core.App, strat Strategy, rec *core.Record) (string, api.ContextSpec, types.DateTime) {
	var lastLensTime types.DateTime
	var lensPrompt string
	var lensSpec api.ContextSpec
	if lensID := rec.GetString("current_lens_id"); lensID != "" {
		if lrec, err := app.FindRecordById(strat.LensCollectionName(), lensID); err == nil {
			_ = lrec.UnmarshalJSONField("prompt", &lensPrompt)
			_ = lrec.UnmarshalJSONField("context_spec", &lensSpec)
			lastLensTime = lrec.GetDateTime("updated")
		}
	}
	return lensPrompt, lensSpec, lastLensTime
}
