package projections

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

var (
	ErrNoApprovedSnapshot = errors.New("projection has no saved snapshot to revise")
)

const (
	briefAwaitTimeout           = 15 * time.Second
	updateStatusTrackerStoreKey = "kalaido.projections.update_status_tracker"
	updateErrorRetention        = 30 * time.Minute
)

var updateStatusInitMu sync.Mutex

type updateErrorEntry struct {
	projectionID string
	message      string
	recordedAt   time.Time
}

type updateStatusTracker struct {
	mu     sync.Mutex
	errors map[string]updateErrorEntry
}

func updateStatusTrackerFor(app core.App) *updateStatusTracker {
	if app == nil {
		return &updateStatusTracker{errors: make(map[string]updateErrorEntry)}
	}
	if v := app.Store().Get(updateStatusTrackerStoreKey); v != nil {
		if t, ok := v.(*updateStatusTracker); ok {
			return t
		}
	}
	updateStatusInitMu.Lock()
	defer updateStatusInitMu.Unlock()
	if v := app.Store().Get(updateStatusTrackerStoreKey); v != nil {
		if t, ok := v.(*updateStatusTracker); ok {
			return t
		}
	}
	t := &updateStatusTracker{errors: make(map[string]updateErrorEntry)}
	app.Store().Set(updateStatusTrackerStoreKey, t)
	return t
}

func recordUpdateError(app core.App, projectionID, claimID string, err error) {
	if err == nil || claimID == "" {
		return
	}
	t := updateStatusTrackerFor(app)
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	for k, v := range t.errors {
		if now.Sub(v.recordedAt) > updateErrorRetention {
			delete(t.errors, k)
		}
	}
	t.errors[claimID] = updateErrorEntry{
		projectionID: projectionID,
		message:      err.Error(),
		recordedAt:   now,
	}
}

func lookupUpdateError(app core.App, projectionID, claimID string) (string, bool) {
	t := updateStatusTrackerFor(app)
	t.mu.Lock()
	defer t.mu.Unlock()
	entry, ok := t.errors[claimID]
	if !ok || entry.projectionID != projectionID {
		return "", false
	}
	return entry.message, true
}

// GetCandidateUpdateStatus reports the live status of an async Update claim:
// "generating", "ready", or "error" (with a recorded human-readable message).
func GetCandidateUpdateStatus(app core.App, projectionID, claimID string) (api.ProjectionCandidateStatusResponse, error) {
	if rec, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), claimID); err == nil {
		if rec.GetString("projection_id") != projectionID {
			return api.ProjectionCandidateStatusResponse{}, ErrNotFound
		}
		switch rec.GetString("status") {
		case engine.StatusGenerating:
			return api.ProjectionCandidateStatusResponse{Status: "generating"}, nil
		case engine.StatusPending, engine.StatusApproved:
			return api.ProjectionCandidateStatusResponse{Status: "ready"}, nil
		default:
			if msg, ok := lookupUpdateError(app, projectionID, claimID); ok {
				return api.ProjectionCandidateStatusResponse{Status: "error", Error: msg}, nil
			}
			return api.ProjectionCandidateStatusResponse{Status: "error", Error: "This draft was discarded."}, nil
		}
	}
	if msg, ok := lookupUpdateError(app, projectionID, claimID); ok {
		return api.ProjectionCandidateStatusResponse{Status: "error", Error: msg}, nil
	}
	if _, err := FindLive(app, projectionID); err != nil {
		return api.ProjectionCandidateStatusResponse{}, ErrNotFound
	}
	return api.ProjectionCandidateStatusResponse{
		Status: "error",
		Error:  "Update failed or was cancelled.",
	}, nil
}

// UpdateResult is returned by RunAnchoredUpdate and StartReviseSession.
type UpdateResult struct {
	SnapshotID   string
	RefinementID string
}

// DiscardResult describes the side effect of discarding a projection draft.
type DiscardResult struct {
	DeletedProjection  bool
	RevertedToProposed bool
}

// PrepareAnchoredUpdate synchronously validates that projectionID can be
// updated, takes the per-projection generation claim, and (when discardExisting
// is true) discards any prior pending_review candidate(s).
func PrepareAnchoredUpdate(ctx context.Context, app core.App, projectionID string, discardExisting bool) (*core.Record, string, error) {
	strat := Strategy{}

	proj, err := FindLive(app, projectionID)
	if err != nil {
		return nil, "", fmt.Errorf("projection not found: %s: %w", projectionID, err)
	}

	_, lensPrompt := engine.ReadActiveLens(app, strat, proj)

	var hasApproved bool
	approvedFilter, approvedParams := engine.ApprovedSnapshotFilter(strat, proj.Id, nil)
	if recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(), approvedFilter, "-approval_sequence_number", 1, 0, approvedParams); err == nil && len(recs) > 0 {
		hasApproved = strings.TrimSpace(recs[0].GetString("output")) != ""
	}

	// Only refuse with ErrLensNotReady when there is neither a saved snapshot
	// nor a standing editorial brief (nor a brief currently distilling).
	if !hasApproved && strings.TrimSpace(lensPrompt) == "" && !IsBriefUpdating(app, proj.Id) {
		return nil, "", fmt.Errorf("projection %s: %w", proj.Id, engine.ErrLensNotReady)
	}

	if _, err := llm.ResolveRoleFor(llm.RoleSnapshot, proj.GetString("generate_with_model")); err != nil {
		return nil, "", err
	}

	claimID, err := engine.ClaimGeneration(app, strat, proj.Id, nil)
	if err != nil {
		return nil, "", err
	}

	if discardExisting {
		if err := app.RunInTransaction(func(tx core.App) error {
			return engine.DiscardOtherPending(tx, strat, proj.Id, nil, claimID)
		}); err != nil {
			engine.ReleaseClaim(app, strat, claimID)
			return nil, "", fmt.Errorf("discard existing candidate: %w", err)
		}
	}

	return proj, claimID, nil
}

// ExecuteClaimedUpdate runs the anchored cross-session update against an
// already-claimed generating snapshot row. On error, it records the failure in
// the in-memory status tracker before releasing the claim row.
func ExecuteClaimedUpdate(ctx context.Context, app core.App, proj *core.Record, claimID string) (res UpdateResult, err error) {
	strat := Strategy{}
	completed := false
	defer func() {
		if !completed {
			if err != nil {
				recordUpdateError(app, proj.Id, claimID, err)
			}
			engine.ReleaseClaim(app, strat, claimID)
		}
	}()

	// Wait briefly if a Save-time brief distillation is still finishing so the
	// update gets the freshest brief when available; fall back gracefully if
	// the timeout expires or distillation failed.
	awaitCtx, cancel := context.WithTimeout(ctx, briefAwaitTimeout)
	AwaitBriefDistillation(awaitCtx, app, proj.Id)
	cancel()

	// Reload projection in case brief distillation updated current_lens_id.
	if freshProj, ferr := FindLive(app, proj.Id); ferr == nil {
		proj = freshProj
	}

	lensID, lensPrompt := engine.ReadActiveLens(app, strat, proj)
	var spec api.ContextSpec
	_ = proj.UnmarshalJSONField("current_context_spec", &spec)

	// Load latest approved snapshot (anchor).
	var prevOutput string
	var prevPinned llmcontext.PinnedIDs
	approvedFilter, approvedParams := engine.ApprovedSnapshotFilter(strat, proj.Id, nil)
	if recs, ferr := app.FindRecordsByFilter(strat.SnapshotCollectionName(), approvedFilter, "-approval_sequence_number", 1, 0, approvedParams); ferr == nil && len(recs) > 0 {
		prevOutput = strings.TrimSpace(recs[0].GetString("output"))
		_ = recs[0].UnmarshalJSONField("resolved_context", &prevPinned)
	}

	if prevOutput == "" && strings.TrimSpace(lensPrompt) == "" {
		return UpdateResult{}, fmt.Errorf("projection %s: %w", proj.Id, engine.ErrLensNotReady)
	}

	model, err := llm.ResolveRoleFor(llm.RoleSnapshot, proj.GetString("generate_with_model"))
	if err != nil {
		return UpdateResult{}, err
	}

	currentPinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, nil)
	if err != nil {
		return UpdateResult{}, fmt.Errorf("resolve context: %w", err)
	}

	// Partition sources into newly arrived/updated vs existing so the anchored
	// prompt can focus on what changed.
	added, _ := llmcontext.DiffPinnedIDs(prevPinned, currentPinned)
	var newSourcesBlock, existingSourcesBlock string
	if !added.IsEmpty() {
		newSourcesBlock, _ = llmcontext.HydrateIDsToText(ctx, app, added)
	}
	existingPinned := existingOnlyPinned(currentPinned, added)
	if !existingPinned.IsEmpty() {
		existingSourcesBlock, _ = llmcontext.HydrateIDsToText(ctx, app, existingPinned)
	}

	started := time.Now()
	logger().Info("running anchored projection update",
		"projection_id", proj.Id, "name", proj.GetString("name"), "model", model,
		"total_fragments", len(currentPinned.FragmentIDs), "new_fragments", len(added.FragmentIDs),
		"total_snapshots", len(currentPinned.SnapshotIDs), "new_snapshots", len(added.SnapshotIDs))

	var summary, updatedDoc string
	var noChanges bool

	if prevOutput != "" {
		prompt := prompts.AnchoredUpdatePrompt(prevOutput, lensPrompt, existingSourcesBlock, newSourcesBlock)
		if err := llm.CheckPromptFits(model, len(prompt)); err != nil {
			return UpdateResult{}, err
		}
		rawResp, err := usage.GenerateOnce(ctx, app, prompt, llm.RoleSnapshot, model, nil)
		if err != nil {
			return UpdateResult{}, fmt.Errorf("anchored update: %w", err)
		}
		summary, updatedDoc, noChanges = prompts.ParseAnchoredUpdateResponse(rawResp)
	} else {
		// No prior approved snapshot yet, only a standing brief.
		allSources, _ := llmcontext.HydrateIDsToText(ctx, app, currentPinned)
		generated, err := engine.GenerateOutput(ctx, app, model, lensPrompt, allSources, nil)
		if err != nil {
			return UpdateResult{}, fmt.Errorf("generate initial snapshot: %w", err)
		}
		updatedDoc = generated
		summary = "I've generated a draft from your current sources."
	}

	var outputDraft string
	var outputRaw string
	var edits []api.SnapshotEdit
	wholesaleReplaced := false

	switch {
	case prevOutput == "":
		if strings.TrimSpace(updatedDoc) == "" {
			return UpdateResult{}, fmt.Errorf("projection %s: model returned empty output", proj.Id)
		}
		outputDraft = updatedDoc
		outputRaw = updatedDoc
		edits = []api.SnapshotEdit{}
	case noChanges || strings.TrimSpace(updatedDoc) == "" || strings.TrimSpace(updatedDoc) == prevOutput:
		outputDraft = prevOutput
		outputRaw = prevOutput
		edits = []api.SnapshotEdit{}
		if summary == "" {
			summary = "I reviewed the new sources and found no changes needed for the current document."
		}
	case engine.ExceedsFullRewriteThreshold(prevOutput, updatedDoc):
		// Above full-rewrite threshold on an explicit Update: swap the draft
		// wholesale without diff markers or a confirmation card, and explain
		// the full replacement clearly in the opening chat message.
		wholesaleReplaced = true
		outputDraft = updatedDoc
		outputRaw = updatedDoc
		edits = []api.SnapshotEdit{}
		note := "Because the new sources changed most of the document, I replaced the full draft rather than showing line-by-line diffs."
		if trimmed := strings.TrimSpace(summary); trimmed != "" {
			summary = note + "\n\n" + trimmed
		} else {
			summary = note
		}
	default:
		outputRaw = updatedDoc
		outputDraft, edits = engine.DiffAndMarkBlocks(prevOutput, updatedDoc, api.EditTypeRegeneration)
	}

	// Persist the attached refinement session before promoting the claim to
	// pending_review so SSE subscribers see both the draft and opening message
	// together. If CompleteClaimedSnapshot fails, ReleaseClaim cascades it away.
	refID, refErr := createAttachedUpdateSession(ctx, app, proj.Id, claimID, spec, currentPinned, summary, model)
	if refErr != nil {
		logger().Warn("failed to attach refinement session after update",
			"projection_id", proj.Id, "snapshot_id", claimID, "error", refErr)
	}

	if err := engine.CompleteClaimedSnapshot(ctx, app, strat, claimID, engine.SnapshotSpec{
		SourceID:        proj.Id,
		LensID:          lensID,
		Output:          "",
		OutputRaw:       outputRaw,
		OutputDraft:     outputDraft,
		Edits:           edits,
		ContextSpec:     spec,
		ResolvedContext: currentPinned,
		Status:          engine.StatusPending,
		Model:           model,
	}); err != nil {
		return UpdateResult{}, fmt.Errorf("save updated candidate: %w", err)
	}
	completed = true

	logger().Info("completed anchored projection update",
		"projection_id", proj.Id, "snapshot_id", claimID, "refinement_id", refID,
		"edits", len(edits), "wholesale_replaced", wholesaleReplaced,
		"duration", time.Since(started).Round(time.Millisecond))

	return UpdateResult{SnapshotID: claimID, RefinementID: refID}, nil
}

// RunAnchoredUpdate performs a synchronous single-call anchored cross-session
// Update for a projection.
func RunAnchoredUpdate(ctx context.Context, app core.App, projectionID string) (UpdateResult, error) {
	proj, claimID, err := PrepareAnchoredUpdate(ctx, app, projectionID, false)
	if err != nil {
		return UpdateResult{}, err
	}
	return ExecuteClaimedUpdate(ctx, app, proj, claimID)
}

// StartAnchoredUpdateAsync synchronously claims the generation row and launches
// ExecuteClaimedUpdate in the background on runner, returning claimID immediately.
func StartAnchoredUpdateAsync(app core.App, runner workerutil.Runner, projectionID string, discardExisting bool) (string, error) {
	proj, claimID, err := PrepareAnchoredUpdate(context.Background(), app, projectionID, discardExisting)
	if err != nil {
		return "", err
	}
	run := func(ctx context.Context) {
		if _, err := ExecuteClaimedUpdate(ctx, app, proj, claimID); err != nil {
			logger().Warn("async anchored projection update failed",
				"projection_id", proj.Id, "claim_id", claimID, "error", err)
		}
	}
	if runner != nil {
		runner.Go(run)
	} else {
		go run(context.Background())
	}
	return claimID, nil
}

func existingOnlyPinned(all, added llmcontext.PinnedIDs) llmcontext.PinnedIDs {
	addedFrags := make(map[string]bool, len(added.FragmentIDs))
	for _, id := range added.FragmentIDs {
		addedFrags[id] = true
	}
	addedSnaps := make(map[string]bool, len(added.SnapshotIDs))
	for _, id := range added.SnapshotIDs {
		addedSnaps[id] = true
	}
	var out llmcontext.PinnedIDs
	for _, id := range all.FragmentIDs {
		if !addedFrags[id] {
			out.FragmentIDs = append(out.FragmentIDs, id)
		}
	}
	for _, id := range all.SnapshotIDs {
		if !addedSnaps[id] {
			out.SnapshotIDs = append(out.SnapshotIDs, id)
		}
	}
	return out
}

func createAttachedUpdateSession(
	ctx context.Context,
	app core.App,
	projectionID, snapshotID string,
	spec api.ContextSpec,
	pinned llmcontext.PinnedIDs,
	summary string,
	model string,
) (string, error) {
	var refID string
	err := app.RunInTransaction(func(tx core.App) error {
		col, err := tx.FindCollectionByNameOrId(schema.ColProjectionRefinement.String())
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.Set("projection_id", projectionID)
		rec.Set("projection_snapshot_id", snapshotID)
		rec.Set("external_conversation_id", security.RandomString(15))
		if err := tx.Save(rec); err != nil {
			return err
		}
		refID = rec.Id

		specData, _ := json.Marshal(spec)
		pinnedData, _ := json.Marshal(pinned)
		ctxMsg := api.UIMessage{
			ID:   fmt.Sprintf("ctx-%d", time.Now().UnixNano()),
			Role: "system",
			Parts: []api.UIMessagePart{
				{Type: "context_spec", Data: specData},
				{Type: "pinned_ids", Data: pinnedData},
			},
		}
		if _, err := chat.PersistMessage(ctx, tx, rec, ctxMsg, ""); err != nil {
			return err
		}

		var assistantParts []api.UIMessagePart
		if strings.TrimSpace(summary) != "" {
			assistantParts = append(assistantParts, api.UIMessagePart{
				Type: "text",
				Text: strings.TrimSpace(summary),
			})
		}
		if len(assistantParts) > 0 {
			openMsg := api.UIMessage{
				ID:    fmt.Sprintf("update-open-%d", time.Now().UnixNano()),
				Role:  "assistant",
				Parts: assistantParts,
			}
			if _, err := chat.PersistMessage(ctx, tx, rec, openMsg, model); err != nil {
				return err
			}
		}
		return nil
	})
	return refID, err
}

// StartReviseSession opens a unified interactive revision session for an
// up-to-date projection: creates a pending_review draft seeded verbatim from
// the current approved snapshot and binds a fresh projection_refinement
// session to it.
func StartReviseSession(ctx context.Context, app core.App, projectionID, clientID string) (UpdateResult, error) {
	strat := Strategy{}
	if strings.TrimSpace(clientID) == "" {
		clientID = security.RandomString(15)
	}

	var res UpdateResult
	err := app.RunInTransaction(func(tx core.App) error {
		proj, err := FindLive(tx, projectionID)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrNotFound, err)
		}

		filter, params := engine.ApprovedSnapshotFilter(strat, proj.Id, nil)
		approvedSnaps, err := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params)
		if err != nil {
			return err
		}
		if len(approvedSnaps) == 0 {
			return ErrNoApprovedSnapshot
		}
		liveSnap := approvedSnaps[0]
		liveOutput := strings.TrimSpace(liveSnap.GetString("output"))

		var spec api.ContextSpec
		if raw := strings.TrimSpace(proj.GetString("current_context_spec")); raw != "" && raw != "null" {
			_ = proj.UnmarshalJSONField("current_context_spec", &spec)
		} else {
			_ = liveSnap.UnmarshalJSONField("context_spec", &spec)
		}

		var pinned llmcontext.PinnedIDs
		_ = liveSnap.UnmarshalJSONField("resolved_context", &pinned)
		if pinned.IsEmpty() {
			if resolved, rerr := llmcontext.ResolveSpecToIDs(ctx, tx, spec, nil); rerr == nil {
				pinned = resolved
			}
		}

		snapID, err := engine.AppendSnapshot(ctx, tx, strat, engine.SnapshotSpec{
			SourceID:        proj.Id,
			LensID:          proj.GetString("current_lens_id"),
			Output:          "",
			OutputRaw:       liveOutput,
			OutputDraft:     liveOutput,
			Edits:           []api.SnapshotEdit{},
			ContextSpec:     spec,
			ResolvedContext: pinned,
			Status:          engine.StatusPending,
			Model:           liveSnap.GetString("generated_by_model"),
		})
		if err != nil {
			return err
		}
		if err := engine.DiscardOtherPending(tx, strat, proj.Id, nil, snapID); err != nil {
			return err
		}

		refCol, err := tx.FindCollectionByNameOrId(schema.ColProjectionRefinement.String())
		if err != nil {
			return err
		}
		refRec := core.NewRecord(refCol)
		refRec.Set("projection_id", proj.Id)
		refRec.Set("projection_snapshot_id", snapID)
		refRec.Set("external_conversation_id", clientID)
		if err := tx.Save(refRec); err != nil {
			return err
		}

		specData, _ := json.Marshal(spec)
		pinnedData, _ := json.Marshal(pinned)
		ctxMsg := api.UIMessage{
			ID:   fmt.Sprintf("ctx-%d", time.Now().UnixNano()),
			Role: "system",
			Parts: []api.UIMessagePart{
				{Type: "context_spec", Data: specData},
				{Type: "pinned_ids", Data: pinnedData},
			},
		}
		if _, err := chat.PersistMessage(ctx, tx, refRec, ctxMsg, ""); err != nil {
			return err
		}

		res = UpdateResult{SnapshotID: snapID, RefinementID: refRec.Id}
		return nil
	})
	return res, err
}

// discardDraftInTx implements the unified draft discard rules inside a
// transaction once the projection has been loaded:
//   - If the projection has >=1 approved snapshot: mark pending_review
//     candidate(s) discarded and delete any stray unbound refinements, leaving
//     the live approved snapshot untouched.
//   - If the projection has 0 approved snapshots (never saved):
//   - Discover-originated (created_by_discover_run_id != ""): mark pending
//     candidates discarded, delete unbound refinements, and revert status to
//     "proposed".
//   - User-created: hard-delete the projection record (cascading its draft
//     snapshots, refinements, and chat messages) so no zombie row lingers in
//     the list or Recently deleted.
func discardDraftInTx(tx core.App, proj *core.Record) (DiscardResult, error) {
	strat := Strategy{}
	approvedFilter, approvedParams := engine.ApprovedSnapshotFilter(strat, proj.Id, nil)
	approved, err := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), approvedFilter, "", 1, 0, approvedParams)
	if err != nil {
		return DiscardResult{}, err
	}

	if len(approved) == 0 && proj.GetString("created_by_discover_run_id") == "" {
		inFlight, err := engine.HasLiveClaim(tx, strat, proj.Id)
		if err != nil {
			return DiscardResult{}, err
		}
		if inFlight {
			return DiscardResult{}, engine.ErrGenerationInFlight
		}
		if err := engine.ScrubContextSpecs(tx, proj.Id, strat.ScrubSpec); err != nil {
			return DiscardResult{}, err
		}
		if err := tx.Delete(proj); err != nil {
			return DiscardResult{}, err
		}
		return DiscardResult{DeletedProjection: true}, nil
	}

	if err := engine.DiscardOtherPending(tx, strat, proj.Id, nil, ""); err != nil {
		return DiscardResult{}, err
	}
	unboundRefs, err := tx.FindRecordsByFilter(
		schema.ColProjectionRefinement.String(),
		"projection_id = {:pid} && projection_snapshot_id = ''",
		"", 0, 0,
		dbx.Params{"pid": proj.Id},
	)
	if err != nil {
		return DiscardResult{}, err
	}
	for _, r := range unboundRefs {
		if err := tx.Delete(r); err != nil {
			return DiscardResult{}, err
		}
	}

	if len(approved) == 0 {
		proj.Set("status", engine.EntityProposed)
		if err := tx.Save(proj); err != nil {
			return DiscardResult{}, err
		}
		return DiscardResult{RevertedToProposed: true}, nil
	}
	return DiscardResult{}, nil
}

// DiscardCandidate discards a pending_review candidate snapshot. If the
// projection has never been saved (0 approved snapshots), it either reverts
// Discover-originated projections back to "proposed" or hard-deletes
// user-created projections so no hollow projection remains.
func DiscardCandidate(app core.App, projectionID, candidateID string) (DiscardResult, error) {
	var res DiscardResult
	err := app.RunInTransaction(func(tx core.App) error {
		proj, _, err := loadPendingCandidate(tx, projectionID, candidateID, "discard")
		if err != nil {
			return err
		}
		res, err = discardDraftInTx(tx, proj)
		return err
	})
	return res, err
}

// DiscardDraftSession discards an open draft session on projectionID even when
// no projection_snapshot row exists yet (e.g., an unbound authoring session).
func DiscardDraftSession(app core.App, projectionID string) (DiscardResult, error) {
	var res DiscardResult
	err := app.RunInTransaction(func(tx core.App) error {
		proj, err := FindLive(tx, projectionID)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrNotFound, err)
		}
		res, err = discardDraftInTx(tx, proj)
		return err
	})
	return res, err
}

// SaveCandidate performs the unified synchronous Save for a projection draft:
// validates zero unresolved edit markers, promotes the pending candidate to
// approved in place, updates projection.current_context_spec and status=active,
// discards stray pending rows, and kicks off asynchronous living editorial
// brief distillation on runner.
func SaveCandidate(
	ctx context.Context,
	app core.App,
	runner workerutil.Runner,
	projectionID, candidateID string,
	refRec *core.Record,
) (string, error) {
	strat := Strategy{}

	// Locate attached refinement session if the caller did not supply one so we
	// capture the final context spec + transcript for brief distillation.
	if refRec == nil && candidateID != "" {
		if recs, err := app.FindRecordsByFilter(
			schema.ColProjectionRefinement.String(),
			"projection_id = {:pid} && projection_snapshot_id = {:sid}",
			"-created", 1, 0,
			dbx.Params{"pid": projectionID, "sid": candidateID},
		); err == nil && len(recs) > 0 {
			refRec = recs[0]
		}
	}

	var transcript []api.UIMessage
	var refPinned llmcontext.PinnedIDs
	var refSpec api.ContextSpec
	var hasRefSpec bool
	if refRec != nil {
		if msgs, err := chat.LoadMessages(ctx, app, refRec); err == nil {
			transcript = msgs
			p, s, _ := llmcontext.LatestPinnedAndSpec(msgs)
			refPinned = p
			refSpec = s
			for _, m := range msgs {
				if m.Role != "system" {
					continue
				}
				for _, part := range m.Parts {
					if part.Type == "context_spec" {
						hasRefSpec = true
					}
				}
			}
		}
	}

	var distillParams DistillBriefParams

	err := app.RunInTransaction(func(tx core.App) error {
		proj, err := FindLive(tx, projectionID)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrNotFound, err)
		}
		snap, err := tx.FindRecordById(strat.SnapshotCollectionName(), candidateID)
		if err != nil {
			return fmt.Errorf("candidate %s: %w", candidateID, err)
		}
		if snap.GetString(strat.ForeignKeyCol()) != projectionID {
			return fmt.Errorf("candidate %s does not belong to projection %s", candidateID, projectionID)
		}

		// Already approved: idempotent no-op.
		if snap.GetInt("approval_sequence_number") > 0 {
			return nil
		}

		switch snap.GetString("status") {
		case engine.StatusGenerating:
			return fmt.Errorf("%w: generation still running", engine.ErrNotApprovable)
		case engine.StatusDiscarded:
			return fmt.Errorf("%w: candidate was superseded", engine.ErrNotApprovable)
		}

		draft := snap.GetString("output_draft")
		if strings.TrimSpace(draft) == "" {
			draft = snap.GetString("output")
		}
		if engine.HasUnresolvedEditMarkers(draft) {
			return fmt.Errorf("%w: candidate has unresolved edits", engine.ErrNotApprovable)
		}
		finalOutput := strings.TrimSpace(draft)
		if finalOutput == "" {
			return fmt.Errorf("%w: candidate has no content", engine.ErrNotApprovable)
		}

		// Determine final context spec & resolved context.
		var finalSpec api.ContextSpec
		var finalPinned llmcontext.PinnedIDs
		if hasRefSpec {
			finalSpec = refSpec
			finalPinned = refPinned
			if finalPinned.IsEmpty() {
				if resolved, rerr := llmcontext.ResolveSpecToIDs(ctx, tx, finalSpec, nil); rerr == nil {
					finalPinned = resolved
				}
			}
		} else {
			if raw := strings.TrimSpace(snap.GetString("context_spec")); raw != "" && raw != "null" {
				_ = snap.UnmarshalJSONField("context_spec", &finalSpec)
			} else {
				_ = proj.UnmarshalJSONField("current_context_spec", &finalSpec)
			}
			_ = snap.UnmarshalJSONField("resolved_context", &finalPinned)
		}

		// Capture prior lens state before commit for async distillation.
		prevLensID, prevLensPrompt := engine.ReadActiveLens(tx, strat, proj)
		edits := engine.LoadSnapshotEdits(snap)

		// Compute next approval sequence number.
		seq := 1
		filter, params := engine.ApprovedSnapshotFilter(strat, projectionID, nil)
		if prevApproved, ferr := tx.FindRecordsByFilter(strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params); ferr == nil && len(prevApproved) > 0 {
			seq = prevApproved[0].GetInt("approval_sequence_number") + 1
		}

		snap.Set("output", finalOutput)
		snap.Set("output_draft", finalOutput)
		snap.Set("context_spec", pbutil.JSONObject(finalSpec))
		snap.Set("resolved_context", pbutil.JSONObject(finalPinned))
		snap.Set("approval_sequence_number", seq)
		snap.Set("approved_at", types.NowDateTime())
		snap.Set("status", engine.StatusApproved)
		if err := tx.Save(snap); err != nil {
			return err
		}

		if err := engine.DiscardOtherPending(tx, strat, projectionID, nil, snap.Id); err != nil {
			return err
		}

		proj.Set("current_context_spec", pbutil.JSONObject(finalSpec))
		proj.Set("status", engine.EntityActive)
		if err := tx.Save(proj); err != nil {
			return err
		}

		refID := ""
		if refRec != nil {
			refID = refRec.Id
		}
		distillParams = DistillBriefParams{
			ProjectionID:        proj.Id,
			PreviousLensID:      prevLensID,
			PreviousLensPrompt:  prevLensPrompt,
			FinalSnapshotOutput: finalOutput,
			RefinementID:        refID,
			Edits:               edits,
			Transcript:          transcript,
			GenerateWithModel:   proj.GetString("generate_with_model"),
		}
		return nil
	})
	if err != nil {
		return "", err
	}

	if distillParams.ProjectionID != "" {
		StartBriefDistillation(runner, app, distillParams)
	}

	return candidateID, nil
}
