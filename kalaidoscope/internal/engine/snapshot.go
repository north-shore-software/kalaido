package engine

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func GenerateOutput(ctx context.Context, app core.App, model, lensPrompt, sourceBlock string) (string, error) {
	output, err := usage.GenerateOnce(ctx, app, prompts.ApplyPrompt(lensPrompt, sourceBlock, types.DateTime{}, types.DateTime{}), llm.RoleSnapshot, model, nil)
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

	model, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("model"))
	if err != nil {
		return "", err
	}

	sourceBlock, pinnedCtx, err := prepareGenerationContext(ctx, app, strat, rec, lensSpec)
	if err != nil {
		return "", fmt.Errorf("prepare context: %w", err)
	}

	var winSpec, resWin any
	var winKey string
	var specVersionNumber int
	if strat.TargetType() == "reflection" {
		if version, ok := GoverningVersion(LoadWindowSpecVersions(rec), time.Now()); ok {
			winSpec = version.Spec
			specVersionNumber = version.VersionNumber
		}

		if window != nil {
			resWin = map[string]string{
				"start": window.Start,
				"end":   window.End,
			}
			winKey = window.Start + "_" + window.End
		}
	}

	var outputStr string

	var outputModel string

	if strings.TrimSpace(lensPrompt) == "" {

		outputStr = ""
	} else {
		out, err := GenerateOutput(ctx, app, model, lensPrompt, sourceBlock)
		if err != nil {
			return "", fmt.Errorf("generate standard: %w", err)
		}
		outputStr = out
		outputModel = model

		if prev := latestApprovedOutput(app, strat, rec.Id, winKey); strings.TrimSpace(prev) != "" && out != prev {
			merged, err := minimizeAgainstPrevious(ctx, app, model, lensPrompt, sourceBlock, prev, out)
			switch {
			case err == nil:
				outputStr = merged
			case errors.Is(err, llmq.ErrPreempted):
				// The same contract as a preempted GenerateOutput: the caller
				// (the reconcile worker) retries the whole generation rather
				// than publishing a half-processed candidate.
				return "", err
			default:
				// The polish steps failing must not fail the generation; the
				// raw candidate is correct, just noisier to diff.
				log.Printf("snapshot %s %s: minimal-diff rewrite failed, keeping raw candidate: %v", strat.TargetType(), rec.Id, err)
			}
		}
	}

	snapID, err := AppendSnapshot(ctx, app, strat.SnapshotCollectionName(), strat.ForeignKeyCol(), SnapshotSpec{
		SourceID:                rec.Id,
		LensID:                  rec.GetString("current_lens_id"),
		Output:                  outputStr,
		ContextSpec:             lensSpec,
		ResolvedContext:         pinnedCtx,
		WindowSpec:              winSpec,
		ResolvedWindow:          resWin,
		Status:                  status,
		Model:                   outputModel,
		WindowKey:               winKey,
		WindowSpecVersionNumber: specVersionNumber,
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

// latestApprovedOutput returns the output of the entity's newest approved
// snapshot (per window for reflections) — the text the review pane diffs
// candidates against — or "" when none exists yet.
func latestApprovedOutput(app core.App, strat Strategy, parentID, windowKey string) string {
	filter, params := approvedSnapshotFilter(strat, parentID, windowKey)
	recs, err := app.FindRecordsByFilter(
		strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params)
	if err != nil || len(recs) == 0 {
		return ""
	}
	return pbutil.DecodeJSONString(recs[0].GetString("output"))
}

// minimizeAgainstPrevious rewrites a freshly generated candidate as a minimal
// edit of the previously approved output. Even at temperature 0 a regeneration
// rewords lines whose information did not change, so a raw candidate diffs
// noisily against its predecessor. The generation conversation continues with
// two turns — name the semantic delta from the previous output as bullets,
// then integrate just those bullets into the previous text — so wording only
// moves where meaning did. A delta of prompts.SnapshotNoChanges short-circuits
// to the previous output verbatim.
func minimizeAgainstPrevious(ctx context.Context, app core.App, model, lensPrompt, sourceBlock, previous, candidate string) (string, error) {
	msgs := []llm.Message{
		{Role: "user", Content: prompts.ApplyPrompt(lensPrompt, sourceBlock, types.DateTime{}, types.DateTime{})},
		{Role: "assistant", Content: candidate},
		{Role: "user", Content: prompts.SnapshotDeltaPrompt(previous)},
	}
	delta, err := usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleSnapshot, model, nil)
	if err != nil {
		return "", fmt.Errorf("semantic delta: %w", err)
	}
	if strings.TrimSpace(delta) == prompts.SnapshotNoChanges {
		return previous, nil
	}
	msgs = append(msgs,
		llm.Message{Role: "assistant", Content: delta},
		llm.Message{Role: "user", Content: prompts.SnapshotMergePrompt()},
	)
	merged, err := usage.GenerateOnceMsgs(ctx, app, msgs, llm.RoleSnapshot, model, nil)
	if err != nil {
		return "", fmt.Errorf("merge: %w", err)
	}
	if strings.TrimSpace(merged) == "" {
		return "", fmt.Errorf("merge returned empty output")
	}
	return strings.TrimSpace(merged), nil
}

// SnapshotIsCurrent reports whether the entity's newest snapshot — pending or
// approved — already reflects what a generation under ctx would consume right
// now: the same active lens and the same resolved context. The reconcile wave
// uses it as its dedup guard, so a repeated "generate all" (or the wave a
// refinement re-triggers) skips entities whose speculative candidate is still
// fresh instead of burning a model call to reproduce it.
func SnapshotIsCurrent(ctx context.Context, app core.App, strat Strategy, rec *core.Record) bool {
	recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
		strat.ForeignKeyCol()+" = {:id}", "-created", 1, 0, dbx.Params{"id": rec.Id})
	if err != nil || len(recs) == 0 {
		return false
	}
	latest := recs[0]
	if latest.GetString("lens_id") != rec.GetString("current_lens_id") {
		return false
	}
	// A model change makes the latest snapshot non-current — but only when both
	// sides are known: legacy and empty-lens snapshots carry no model and must
	// not read as perpetually stale.
	if snapModel := latest.GetString("model"); snapModel != "" {
		if effective, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("model")); err == nil && effective != snapModel {
			return false
		}
	}
	_, lensSpec, _ := resolveActiveLens(app, strat, rec)
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, lensSpec)
	if err != nil {
		return false
	}
	var recorded llmcontext.PinnedIDs
	_ = latest.UnmarshalJSONField("resolved_context", &recorded)
	added, removed := llmcontext.DiffPinnedIDs(recorded, pinned)
	return added.IsEmpty() && removed.IsEmpty()
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
