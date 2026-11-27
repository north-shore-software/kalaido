package engine

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

// resolveActiveLens loads the entity's current lens — the standing instruction
// its refinement chat drafted and its commit installed (see CommitRefinement)
// — and the scope it applies to, which is the entity's own
// current_context_spec: the lens carries no copy, so a spec edit that never
// touches the lens (the colour-delete scrub) is what the next generation runs.
func resolveActiveLens(app core.App, strat Strategy, rec *core.Record) (string, api.ContextSpec) {
	_, lensPrompt := ReadActiveLens(app, strat, rec)
	var spec api.ContextSpec
	_ = rec.UnmarshalJSONField("current_context_spec", &spec)
	return lensPrompt, spec
}

// ReadActiveLens returns the entity's current lens id and prompt text (empty
// strings when no lens is installed yet).
func ReadActiveLens(app core.App, strat Strategy, rec *core.Record) (lensID, prompt string) {
	lensID = rec.GetString("current_lens_id")
	if lensID == "" {
		return "", ""
	}
	if lrec, err := app.FindRecordById(strat.LensCollectionName(), lensID); err == nil {
		return lensID, lrec.GetString("prompt")
	}
	return lensID, ""
}

// UpdateActiveLens appends a new lens row (chaining parent_lens_id to the
// entity's prior current_lens_id) and updates current_lens_id in one
// transaction.
func UpdateActiveLens(app core.App, strat Strategy, parentID, prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	var newLensID string
	err := app.RunInTransaction(func(tx core.App) error {
		parentRec, err := FindLive(tx, strat, parentID)
		if err != nil {
			return fmt.Errorf("parent %s %s: %w", strat.TargetType(), parentID, err)
		}
		lensCol, err := tx.FindCollectionByNameOrId(strat.LensCollectionName())
		if err != nil {
			return err
		}
		lensRec := core.NewRecord(lensCol)
		if oldLensID := parentRec.GetString("current_lens_id"); oldLensID != "" {
			lensRec.Set("parent_lens_id", oldLensID)
		}
		lensRec.Set("prompt", prompt)
		if err := tx.Save(lensRec); err != nil {
			return err
		}
		parentRec.Set("current_lens_id", lensRec.Id)
		if err := tx.Save(parentRec); err != nil {
			return err
		}
		newLensID = lensRec.Id
		return nil
	})
	if err != nil {
		return "", err
	}
	return newLensID, nil
}
