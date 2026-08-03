package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/internal/api"
	"github.com/north-shore-software/kalaido/internal/llmcontext"
	"github.com/north-shore-software/kalaido/internal/prompts"
	"github.com/north-shore-software/kalaido/internal/usage"
	"github.com/north-shore-software/kalaido/llm"
)

func GenerateOutput(ctx context.Context, app core.App, lensPrompt, sourceBlock string) (string, error) {
	output, err := usage.GenerateOnce(ctx, app, prompts.ApplyPrompt(lensPrompt, sourceBlock, types.DateTime{}, types.DateTime{}), llm.RoleSnapshot, nil)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(output), nil
}

func GenerateSnapshot(ctx context.Context, app core.App, targetID, status string, strat Strategy, window *api.Window) (string, error) {
	if status == "" {
		status = StatusApproved
	}

	rec, err := app.FindRecordById(strat.CollectionName(), targetID)
	if err != nil {
		return "", fmt.Errorf("%s not found: %s", strat.TargetType(), targetID)
	}

	lensPrompt, lensSpec, _ := resolveActiveLens(app, strat, rec)

	sourceBlock, pinnedCtx, err := prepareGenerationContext(ctx, app, strat, rec, lensSpec)
	if err != nil {
		return "", fmt.Errorf("prepare context: %w", err)
	}

	var outputStr string

	var outputModel string

	if strings.TrimSpace(lensPrompt) == "" {

		outputStr = ""
	} else {
		out, err := GenerateOutput(ctx, app, lensPrompt, sourceBlock)
		if err != nil {
			return "", fmt.Errorf("generate standard: %w", err)
		}
		outputStr = out
		outputModel, _ = llm.ResolveRole(llm.RoleSnapshot)
	}

	var winSpec, resWin any
	if strat.TargetType() == "reflection" {
		var currentWindowSpec api.WindowSpec
		_ = rec.UnmarshalJSONField("current_window_spec", &currentWindowSpec)
		winSpec = currentWindowSpec

		if window != nil {
			resWin = map[string]string{
				"start": window.Start,
				"end":   window.End,
			}
		}
	}

	snapID, err := AppendSnapshot(ctx, app, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), SnapshotSpec{
		SourceID:        rec.Id,
		LensID:          rec.GetString("current_lens_id"),
		Output:          outputStr,
		ContextSpec:     lensSpec,
		ResolvedContext: pinnedCtx,
		WindowSpec:      winSpec,
		ResolvedWindow:  resWin,
		Status:          status,
		Model:           outputModel,
	})
	if err != nil {
		return "", fmt.Errorf("snapshot save: %w", err)
	}

	if status == StatusApproved {

		if err := ApproveSnapshot(ctx, app, strat, snapID); err != nil {
			return "", fmt.Errorf("%s approve: %w", strat.TargetType(), err)
		}
	}
	return snapID, nil
}

func prepareGenerationContext(ctx context.Context, app core.App, strat Strategy, rec *core.Record, lensSpec api.ContextSpec) (string, llmcontext.PinnedIDs, error) {
	var sourceBlock string
	var pinnedCtx llmcontext.PinnedIDs
	if pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, lensSpec); err == nil {
		if strat.EnsureFragmentsOnly() && len(pinned.SnapshotIDs) > 0 {
			return "", pinnedCtx, fmt.Errorf("this context must contain fragments only, but snapshots were provided")
		}
		if len(pinned.FragmentIDs)+len(pinned.SnapshotIDs) > 0 {
			sourceBlock, _ = llmcontext.HydrateIDsToText(ctx, app, pinned)
			pinnedCtx = pinned
		}
	}
	return sourceBlock, pinnedCtx, nil
}
