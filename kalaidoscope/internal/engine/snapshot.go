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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func GenerateOutput(ctx context.Context, app core.App, model, lensPrompt, sourceBlock string, win *api.Window) (string, error) {
	start, end := WindowBounds(win)
	prompt := prompts.ApplyPrompt(lensPrompt, sourceBlock, start, end)
	if err := llm.CheckPromptFits(model, len(prompt)); err != nil {
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

	claimID, err := ClaimGeneration(app, strat, rec.Id, window)
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
	outputRaw := outputStr

	var outputDraft string
	var edits []api.SnapshotEdit
	unchanged := false
	prev, otherLens := latestApprovedOutput(app, strat, rec.Id, window, lensID)
	switch {
	case otherLens || strings.TrimSpace(prev) == "":
		if otherLens {
			logger().Info("lens changed since last approval; generating from scratch", "target_type", strat.TargetType(), "id", rec.Id)
		}
		outputDraft = outputRaw
		edits = []api.SnapshotEdit{}
	case outputStr == prev:
		logger().Info("candidate matches the approved output byte-for-byte; nothing to rewrite", "target_type", strat.TargetType(), "id", rec.Id)
		unchanged = true
		outputDraft = prev
		edits = []api.SnapshotEdit{}
	default:
		outputDraft = prev
		merged, err := minimizeAgainstPrevious(ctx, app, model, lensPrompt, sourceBlock, window, prev, outputStr)
		switch {
		case err == nil:
			if merged == prev {
				logger().Info("delta reported no semantic change; republishing the approved output verbatim", "target_type", strat.TargetType(), "id", rec.Id)
				unchanged = true
				outputStr = merged
				edits = []api.SnapshotEdit{}
			} else {
				logger().Info("stored minimal-diff rewrite of the candidate", "target_type", strat.TargetType(), "id", rec.Id)
				outputStr = merged
				outputDraft, edits = DiffAndMarkBlocks(prev, merged, api.EditTypeRegeneration)
			}
		case errors.Is(err, queue.ErrPreempted):
			return "", err
		case ctx.Err() != nil:
			return "", fmt.Errorf("minimal-diff rewrite: %w", context.Cause(ctx))
		default:
			logger().Warn("minimal-diff rewrite failed, keeping raw candidate", "target_type", strat.TargetType(), "id", rec.Id, "error", err)
			outputDraft, edits = DiffAndMarkBlocks(prev, outputRaw, api.EditTypeRegeneration)
		}
	}

	if strings.TrimSpace(outputStr) == "" {
		return "", fmt.Errorf("%s %s: model returned empty output", strat.TargetType(), rec.Id)
	}

	if unchanged && (llmcontext.GenerationTriggerFromContext(ctx) != "" || llmcontext.SettleUnchangedFromContext(ctx)) {
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
	}

	var finalOutput string
	if status == StatusApproved {
		finalOutput = outputStr
		outputDraft = outputStr
		edits = []api.SnapshotEdit{}
	}

	if err := completeClaimedSnapshot(ctx, app, strat, claimID, SnapshotSpec{
		SourceID:        rec.Id,
		LensID:          lensID,
		Output:          finalOutput,
		OutputRaw:       outputRaw,
		OutputDraft:     outputDraft,
		Edits:           edits,
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
	// approved snapshots count. `created` has millisecond precision, so two
	// rows can tie: -approval_sequence_number settles it between approved
	// rows, and insertion order (rowid) between pending ones — a hand edit
	// lands its row after the candidate it edited, in the same transaction.
	var recs []*core.Record
	err := app.RecordQuery(strat.SnapshotCollectionName()).
		AndWhere(dbx.HashExp{strat.ForeignKeyCol(): rec.Id}).
		AndWhere(dbx.In("status", StatusPending, StatusApproved)).
		OrderBy("created DESC", "approval_sequence_number DESC", "rowid DESC").
		Limit(1).
		All(&recs)
	if err != nil || len(recs) == 0 {
		return false
	}
	latest := recs[0]
	_, lensSpec := resolveActiveLens(app, strat, rec)
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, lensSpec, nil)
	if err != nil {
		return false
	}
	current, _ := SnapshotCurrency(rec, latest, pinned)
	return current
}

// Why a snapshot is not current, as SnapshotCurrency reports it. The
// evaluator narrows CurrencyContextChanged to CurrencyNewFragments when the
// drift is (at least) fragments the candidate never saw, which is the case the
// UI can count.
const (
	CurrencyLensChanged    = "lens_changed"
	CurrencyModelChanged   = "model_changed"
	CurrencyContextChanged = "context_changed"
	CurrencyNewFragments   = "new_fragments"
)

// SnapshotCurrency reports whether snap already reflects what a generation of
// rec would consume, given the entity's context already resolved to pinned —
// the same three checks as SnapshotIsCurrent (lens, effective model, resolved
// context), split out so a caller that has resolved the spec for its own
// purposes does not resolve it twice. The reason is "" when current.
func SnapshotCurrency(rec, snap *core.Record, pinned llmcontext.PinnedIDs) (bool, string) {
	if snap.GetString("lens_id") != rec.GetString("current_lens_id") {
		return false, CurrencyLensChanged
	}
	// A model change makes the snapshot non-current — but only when both
	// sides are known: legacy and empty-lens snapshots carry no model and must
	// not read as perpetually stale.
	if snapModel := snap.GetString("generated_by_model"); snapModel != "" {
		if effective, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("generate_with_model")); err == nil && effective != snapModel {
			return false, CurrencyModelChanged
		}
	}
	var recorded llmcontext.PinnedIDs
	_ = snap.UnmarshalJSONField("resolved_context", &recorded)
	added, removed := llmcontext.DiffPinnedIDs(recorded, pinned)
	if !added.IsEmpty() || !removed.IsEmpty() {
		return false, CurrencyContextChanged
	}
	return true, ""
}

// FindPendingCandidate returns the parent's pending candidate (per window for
// reflections), or nil when there is none. At most one exists per target.
func FindPendingCandidate(app core.App, strat Strategy, parentID string, window *api.Window) (*core.Record, error) {
	filter, params := statusSnapshotFilter(strat, parentID, window, StatusPending)
	recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "-created", 1, 0, params)
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, nil
	}
	return recs[0], nil
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

// CandidateEngaged reports whether the user has invested in a pending
// candidate: a hand edit or chat proposal in its edits (regeneration-typed
// edits are machine diff markers and do not count), or a refinement
// conversation opened on it. The machine never replaces an engaged candidate;
// only an explicit user choice does.
func CandidateEngaged(app core.App, strat Strategy, snap *core.Record) (bool, error) {
	if snap == nil {
		return false, nil
	}
	for _, edit := range LoadSnapshotEdits(snap) {
		if edit.Type == api.EditTypeManual || edit.Type == api.EditTypeRefinement {
			return true, nil
		}
	}
	if strat.TargetType() == "projection" {
		recs, err := app.FindRecordsByFilter(schema.ColProjectionRefinement.String(), "projection_snapshot_id = {:id}", "", 1, 0, dbx.Params{"id": snap.Id})
		if err != nil {
			return false, err
		}
		if len(recs) > 0 {
			return true, nil
		}
	}
	return false, nil
}
