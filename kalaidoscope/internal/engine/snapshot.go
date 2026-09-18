package engine

import (
	"context"
	"errors"
	"fmt"
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

func GenerateOutput(ctx context.Context, app core.App, model, lensPrompt, sourceBlock string, win *api.Window) (string, error) {
	start, end := WindowBounds(win)
	prompt := prompts.ApplyPrompt(lensPrompt, sourceBlock, start, end)
	if err := CheckPromptFits(model, len(prompt)); err != nil {
		return "", err
	}
	output, err := usage.GenerateOnce(ctx, app, prompt, llm.RoleSnapshot, model, nil)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(output), nil
}

func GenerateSnapshot(ctx context.Context, app core.App, targetID, status string, strat Strategy, window *api.Window) (string, error) {
	if status == "" {
		status = StatusApproved
	}

	rec, err := FindLive(app, strat, targetID)
	if err != nil {
		return "", fmt.Errorf("%s not found: %s: %w", strat.TargetType(), targetID, err)
	}

	lensPrompt, lensSpec := resolveActiveLens(app, strat, rec)
	if strings.TrimSpace(lensPrompt) == "" {
		// The entity has never had a refinement committed — a commit installs
		// the drafted lens in the same transaction as the approved snapshot,
		// so this is unreachable for anything the user has ever approved.
		// Refuse rather than persist an empty document as a candidate.
		return "", fmt.Errorf("%s %s: %w", strat.TargetType(), rec.Id, ErrLensNotReady)
	}

	// Non-empty whenever lensPrompt is: resolveActiveLens loads the prompt
	// from this very record, so the anchor lookup below never binds an empty
	// lens id (which would hit the empty-param-vs-NULL quirk noted in
	// statusSnapshotFilter).
	lensID := rec.GetString("current_lens_id")

	model, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("generate_with_model"))
	if err != nil {
		return "", err
	}

	claimID, err := claimGeneration(app, strat, rec.Id, window)
	if err != nil {
		return "", err
	}
	completed := false
	defer func() {
		if !completed {
			releaseClaim(app, strat, claimID)
		}
	}()

	sourceBlock, pinnedCtx, err := prepareGenerationContext(ctx, app, strat, rec, lensSpec, window)
	if err != nil {
		return "", fmt.Errorf("prepare context: %w", err)
	}

	started := time.Now()
	logger().Info("generating snapshot",
		"target_type", strat.TargetType(), "id", rec.Id, "name", rec.GetString("name"), "model", model,
		"fragments", len(pinnedCtx.FragmentIDs), "snapshots", len(pinnedCtx.SnapshotIDs))

	outputStr, err := GenerateOutput(ctx, app, model, lensPrompt, sourceBlock, window)
	if err != nil {
		return "", fmt.Errorf("generate standard: %w", err)
	}
	outputModel := model

	// unchanged: the regeneration reproduced the approved output. The
	// candidate would be a document identical to the one already approved.
	unchanged := false
	switch prev, otherLens := latestApprovedOutput(app, strat, rec.Id, window, lensID); {
	case otherLens:
		// The published output was produced by a different lens. Its wording
		// and shape are not this lens's to preserve — the minimal-diff rewrite
		// would erase exactly the changes the new lens exists to make — so the
		// raw candidate is the snapshot, as for a first generation.
		logger().Info("lens changed since last approval; generating from scratch", "target_type", strat.TargetType(), "id", rec.Id)
	case strings.TrimSpace(prev) == "":
		// First generation for this target (and window): nothing to anchor to.
	case outputStr == prev:
		logger().Info("candidate matches the approved output byte-for-byte; nothing to rewrite", "target_type", strat.TargetType(), "id", rec.Id)
		unchanged = true
	default:
		merged, err := minimizeAgainstPrevious(ctx, app, model, lensPrompt, sourceBlock, window, prev, outputStr)
		switch {
		case err == nil:
			if merged == prev {
				logger().Info("delta reported no semantic change; republishing the approved output verbatim", "target_type", strat.TargetType(), "id", rec.Id)
				unchanged = true
			} else {
				logger().Info("stored minimal-diff rewrite of the candidate", "target_type", strat.TargetType(), "id", rec.Id)
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
			logger().Warn("minimal-diff rewrite failed, keeping raw candidate", "target_type", strat.TargetType(), "id", rec.Id, "error", err)
		}
	}

	if strings.TrimSpace(outputStr) == "" {
		return "", fmt.Errorf("%s %s: model returned empty output", strat.TargetType(), rec.Id)
	}

	if unchanged && llmcontext.GenerationTriggerFromContext(ctx) != "" {
		// A speculative regeneration that changed nothing is not something
		// to review: the approved snapshot simply records that it now
		// reflects this context too. No new row, so the approval sequence
		// does not move and dependents are not made stale by a no-op. (An
		// interactive regeneration keeps producing a candidate — the user
		// asked to see the result.) The claim row is released by the defer.
		settledID, err := settleApprovedInPlace(app, strat, rec.Id, window, lensID, SnapshotSpec{
			ContextSpec:     lensSpec,
			ResolvedContext: pinnedCtx,
			Model:           outputModel,
		})
		if err != nil {
			return "", fmt.Errorf("settle in place: %w", err)
		}
		if settledID != "" {
			logger().Info("snapshot unchanged; approved snapshot now records the current context",
				"target_type", strat.TargetType(), "id", rec.Id, "name", rec.GetString("name"),
				"snapshot_id", settledID, "duration", time.Since(started).Round(time.Millisecond))
			return settledID, nil
		}
		// The approved snapshot moved under us; fall through and store the
		// candidate as usual.
	}

	if err := completeClaimedSnapshot(ctx, app, strat, claimID, SnapshotSpec{
		SourceID:        rec.Id,
		LensID:          lensID,
		Output:          outputStr,
		ContextSpec:     lensSpec,
		ResolvedContext: pinnedCtx,
		Window:          window,
		Status:          status,
		Model:           outputModel,
	}); err != nil {
		return "", fmt.Errorf("snapshot save: %w", err)
	}
	completed = true
	logger().Info("stored snapshot",
		"target_type", strat.TargetType(), "id", rec.Id, "name", rec.GetString("name"), "status", status,
		"snapshot_id", claimID, "chars", len(outputStr), "duration", time.Since(started).Round(time.Millisecond))

	if status == StatusApproved {

		if err := ApproveSnapshot(ctx, app, strat, claimID); err != nil {
			return "", fmt.Errorf("%s approve: %w", strat.TargetType(), err)
		}
	}
	return claimID, nil
}

// settleApprovedInPlace updates the current approved snapshot (per window for
// reflections) to record the context and model of a regeneration that
// reproduced its output, and discards any pending candidate that regeneration
// supersedes. Returns "" without writing when the newest approved snapshot is
// no longer the one produced by lensID — the anchor the caller compared
// against has moved, and a candidate is the safe answer.
func settleApprovedInPlace(app core.App, strat Strategy, parentID string, window *api.Window, lensID string, s SnapshotSpec) (string, error) {
	var settledID string
	err := app.RunInTransaction(func(tx core.App) error {
		filter, params := ApprovedSnapshotFilter(strat, parentID, window)
		recs, err := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params)
		if err != nil {
			return err
		}
		if len(recs) == 0 || recs[0].GetString("lens_id") != lensID {
			return nil
		}
		snap := recs[0]
		snap.Set("context_spec", pbutil.JSONObject(s.ContextSpec))
		snap.Set("resolved_context", pbutil.JSONObject(s.ResolvedContext))
		// The model that just reproduced the output; without this a model
		// change would read as perpetually stale (SnapshotIsCurrent).
		snap.Set("generated_by_model", s.Model)
		snap.Set("generated_at", types.NowDateTime())
		if err := tx.Save(snap); err != nil {
			return err
		}
		settledID = snap.Id
		return discardOtherPending(tx, strat, parentID, window, snap.Id)
	})
	return settledID, err
}

// latestApprovedOutput returns the output of the entity's newest approved
// snapshot (per window for reflections) — the anchor a regeneration minimizes
// against — or "" when none exists yet. Only an approved snapshot produced by
// lensID qualifies: the minimal-diff rewrite preserves the anchor's wording
// and shape, which is right when the same lens is re-run over new sources and
// wrong when the lens itself changed. otherLens reports the latter — the
// newest approved snapshot exists but belongs to another lens — so the caller
// can say why it is generating from scratch.
func latestApprovedOutput(app core.App, strat Strategy, parentID string, window *api.Window, lensID string) (output string, otherLens bool) {
	filter, params := ApprovedSnapshotFilter(strat, parentID, window)
	recs, err := app.FindRecordsByFilter(
		strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params)
	if err != nil || len(recs) == 0 {
		return "", false
	}
	if recs[0].GetString("lens_id") != lensID {
		return "", true
	}
	return recs[0].GetString("output"), false
}

// minimizeAgainstPrevious rewrites a freshly generated candidate as a minimal
// edit of the previously approved output of the same lens. Even at temperature
// 0 a regeneration rewords lines whose information did not change, so a raw
// candidate diffs noisily against its predecessor. Callers must not pass an
// output produced by a different lens: the delta turn ignores wording, ordering
// and formatting differences by design, and would hand back the old document. The generation conversation continues with
// two turns — name the semantic delta from the previous output as bullets,
// then integrate just those bullets into the previous text — so wording only
// moves where meaning did. A delta of prompts.SnapshotNoChanges short-circuits
// to the previous output verbatim.
func minimizeAgainstPrevious(ctx context.Context, app core.App, model, lensPrompt, sourceBlock string, win *api.Window, previous, candidate string) (string, error) {
	start, end := WindowBounds(win)
	msgs := []llm.Message{
		{Role: "user", Content: prompts.ApplyPrompt(lensPrompt, sourceBlock, start, end)},
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
		strat.ForeignKeyCol()+" = {:id} && (status = 'pending_review' || status = 'approved')",
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
	if snapModel := latest.GetString("generated_by_model"); snapModel != "" {
		if effective, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("generate_with_model")); err == nil && effective != snapModel {
			return false
		}
	}
	_, lensSpec := resolveActiveLens(app, strat, rec)
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, lensSpec, nil)
	if err != nil {
		return false
	}
	var recorded llmcontext.PinnedIDs
	_ = latest.UnmarshalJSONField("resolved_context", &recorded)
	added, removed := llmcontext.DiffPinnedIDs(recorded, pinned)
	return added.IsEmpty() && removed.IsEmpty()
}

// prepareGenerationContext resolves the lens's spec — inside the window for a
// windowed reflection generation — and renders it as the prompt's source block.
func prepareGenerationContext(ctx context.Context, app core.App, strat Strategy, rec *core.Record, lensSpec api.ContextSpec, window *api.Window) (string, llmcontext.PinnedIDs, error) {
	var sourceBlock string
	var pinnedCtx llmcontext.PinnedIDs
	if pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, lensSpec, window); err == nil {
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
