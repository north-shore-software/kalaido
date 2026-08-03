package engine

import (
	"context"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/internal/api"
	"github.com/north-shore-software/kalaido/internal/llmcontext"
	"github.com/north-shore-software/kalaido/internal/pbutil"
	"github.com/north-shore-software/kalaido/internal/prompts"
	"github.com/north-shore-software/kalaido/internal/usage"
	"github.com/north-shore-software/kalaido/llm"
)

func DistillLens(ctx context.Context, app core.App, sourceBlock, sample string) (string, error) {
	out, err := usage.GenerateOnce(ctx, app, prompts.DistillPrompt(sourceBlock, sample, types.DateTime{}, types.DateTime{}), llm.RoleDistill, nil)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

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

func DistillAndUpdateLens(ctx context.Context, app core.App, strat Strategy, snapshotID, oldLensID string, spec api.ContextSpec, refinementID, targetCol string) error {
	snap, err := app.FindRecordById(strat.SnapshotCollectionName(), snapshotID)
	if err != nil {
		return err
	}
	parentID := snap.GetString(strat.ForeignKeyCol())
	rec, err := app.FindRecordById(strat.CollectionName(), parentID)
	if err != nil {
		return err
	}

	var resCtx llmcontext.PinnedIDs
	_ = snap.UnmarshalJSONField("resolved_context", &resCtx)
	sourceBlock := llmcontext.RenderFragmentRecords(llmcontext.LoadFragmentsByIDs(ctx, app, resCtx.FragmentIDs))

	output := pbutil.DecodeJSONString(snap.GetString("output"))

	newLensPrompt, err := DistillLens(ctx, app, sourceBlock, output)
	if err != nil {
		return err
	}

	col, _ := app.FindCollectionByNameOrId(strat.LensCollectionName())
	lensRec := core.NewRecord(col)
	if oldLensID != "" {
		lensRec.Set("parent_lens_id", oldLensID)
	}
	lensRec.Set("prompt", pbutil.JSONString(newLensPrompt))
	lensRec.Set("context_spec", pbutil.JSONObject(spec))
	if model, err := llm.ResolveRole(llm.RoleDistill); err == nil {
		lensRec.Set("model", model)
	}
	if refinementID != "" {
		if targetCol == "projection" {
			lensRec.Set("created_from_proj_refinement_id", refinementID)
		} else {
			lensRec.Set("created_from_refl_refinement_id", refinementID)
		}
	}
	if err := app.Save(lensRec); err != nil {
		return err
	}

	rec.Set("current_lens_id", lensRec.Id)
	if err := app.Save(rec); err != nil {
		return err
	}

	snap.Set("lens_id", lensRec.Id)
	return app.Save(snap)
}
