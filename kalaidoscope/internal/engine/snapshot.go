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
	if strings.TrimSpace(lensPrompt) == "" {
		// Normal right after a refinement commit: current_lens_id stays empty
		// until the background distillation worker mints the lens. Refuse
		// rather than persist an empty document as a reviewable candidate.
		return "", fmt.Errorf("%s %s: %w", strat.TargetType(), rec.Id, ErrLensNotReady)
	}

	model, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("model"))
	if err != nil {
		return "", err
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

	claimID, err := claimGeneration(app, strat, rec.Id, winKey)
	if err != nil {
		return "", err
	}
	completed := false
	defer func() {
		if !completed {
			releaseClaim(app, strat, claimID)
		}
	}()

	sourceBlock, pinnedCtx, err := prepareGenerationContext(ctx, app, strat, rec, lensSpec)
	if err != nil {
		return "", fmt.Errorf("prepare context: %w", err)
	}

	outputStr, err := GenerateOutput(ctx, app, model, lensPrompt, sourceBlock)
	if err != nil {
		return "", fmt.Errorf("generate standard: %w", err)
	}
	outputModel := model

	switch prev := latestApprovedOutput(app, strat, rec.Id, winKey); {
	case strings.TrimSpace(prev) == "":
		// First generation for this target (and window): nothing to anchor to.
	case outputStr == prev:
		log.Printf("snapshot %s %s: candidate matches the approved output byte-for-byte; nothing to rewrite", strat.TargetType(), rec.Id)
	default:
		merged, err := minimizeAgainstPrevious(ctx, app, model, lensPrompt, sourceBlock, prev, outputStr)
		switch {
		case err == nil:
			if merged == prev {
				log.Printf("snapshot %s %s: delta reported no semantic change; republishing the approved output verbatim", strat.TargetType(), rec.Id)
			} else {
				log.Printf("snapshot %s %s: stored minimal-diff rewrite of the candidate", strat.TargetType(), rec.Id)
			}
			outputStr = merged
		case errors.Is(err, llmq.ErrPreempted):
			// The same contract as a preempted GenerateOutput: the caller
			// (the reconcile worker) retries the whole generation rather
			// than publishing a half-processed candidate.
			return "", err
		case ctx.Err() != nil:
			// The whole generation is being abandoned, and the raw candidate
			// itself may be a mid-stream truncation. Abort; persist nothing.
			return "", fmt.Errorf("minimal-diff rewrite: %w", context.Cause(ctx))
		default:
			// The polish steps failing must not fail the generation; the
			// raw candidate is correct, just noisier to diff.
			log.Printf("snapshot %s %s: minimal-diff rewrite failed, keeping raw candidate: %v", strat.TargetType(), rec.Id, err)
		}
	}

	if strings.TrimSpace(outputStr) == "" {
		return "", fmt.Errorf("%s %s: model returned empty output", strat.TargetType(), rec.Id)
	}

	if err := completeClaimedSnapshot(ctx, app, strat, claimID, SnapshotSpec{
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
	}); err != nil {
		return "", fmt.Errorf("snapshot save: %w", err)
	}
	completed = true

	if status == StatusApproved {

		if err := ApproveSnapshot(ctx, app, strat, claimID); err != nil {
			return "", fmt.Errorf("%s approve: %w", strat.TargetType(), err)
		}
	}
	return claimID, nil
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
	// Claim rows and superseded candidates are not output; only pending and
	// approved snapshots count. -approval_sequence_number breaks same-millisecond
	// `created` ties deterministically (see .agents/bugs/engine-2026-08-20…).
	recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
		strat.ForeignKeyCol()+" = {:id} && (status = 'pending' || status = 'approved')",
		"-created,-approval_sequence_number", 1, 0, dbx.Params{"id": rec.Id})
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
