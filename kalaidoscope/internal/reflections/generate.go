package reflections

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// GenerateWindowSnapshot generates an approved snapshot for one reflection
// window by applying the reflection's standing lens directly to that window's
// resolved fragments (no pending_review state, no minimizeAgainstPrevious).
//
// When zero fragments match the window, the LLM call is skipped and a
// hardcoded approved empty snapshot (generated_by_model = "empty") is stored so
// the timeline records the window without spending tokens.
func GenerateWindowSnapshot(ctx context.Context, app core.App, reflectionID string, window *api.Window) (string, error) {
	strat := Strategy{}
	rec, err := FindLive(app, reflectionID)
	if err != nil {
		return "", fmt.Errorf("reflection not found: %s: %w", reflectionID, err)
	}

	lensID, lensPrompt := engine.ReadActiveLens(app, strat, rec)
	if strings.TrimSpace(lensPrompt) == "" {
		return "", fmt.Errorf("reflection %s: %w", rec.Id, engine.ErrLensNotReady)
	}

	var spec api.ContextSpec
	_ = rec.UnmarshalJSONField("current_context_spec", &spec)

	claimID, err := engine.ClaimGeneration(app, strat, rec.Id, window)
	if err != nil {
		return "", err
	}
	completed := false
	defer func() {
		if !completed {
			engine.ReleaseClaim(app, strat, claimID)
		}
	}()

	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, window)
	if err != nil {
		return "", fmt.Errorf("resolve context: %w", err)
	}
	if len(pinned.SnapshotIDs) > 0 {
		return "", fmt.Errorf("this context must contain fragments only, but snapshots were provided")
	}

	started := time.Now()
	var outputStr string
	var outputModel string

	if len(pinned.FragmentIDs) == 0 {
		logger().Info("generating empty reflection window snapshot (0 matching fragments)",
			"id", rec.Id, "name", rec.GetString("name"))
		outputStr = EmptyWindowOutput
		outputModel = engine.SnapshotModelEmpty
		pinned = llmcontext.PinnedIDs{}
	} else {
		model, err := llm.ResolveRoleFor(llm.RoleSnapshot, rec.GetString("generate_with_model"))
		if err != nil {
			return "", err
		}
		sourceBlock, err := llmcontext.HydrateIDsToText(ctx, app, pinned)
		if err != nil {
			return "", fmt.Errorf("hydrate context: %w", err)
		}
		logger().Info("generating reflection window snapshot",
			"id", rec.Id, "name", rec.GetString("name"), "model", model,
			"fragments", len(pinned.FragmentIDs))

		generated, err := engine.GenerateOutput(ctx, app, model, lensPrompt, sourceBlock, window)
		if err != nil {
			return "", fmt.Errorf("generate reflection snapshot: %w", err)
		}
		if strings.TrimSpace(generated) == "" {
			return "", fmt.Errorf("reflection %s: model returned empty output", rec.Id)
		}
		outputStr = generated
		outputModel = model
	}

	if err := engine.CompleteClaimedSnapshot(ctx, app, strat, claimID, engine.SnapshotSpec{
		SourceID:        rec.Id,
		LensID:          lensID,
		Output:          outputStr,
		OutputRaw:       outputStr,
		OutputDraft:     outputStr,
		Edits:           []api.SnapshotEdit{},
		ContextSpec:     spec,
		ResolvedContext: pinned,
		Window:          window,
		Status:          engine.StatusApproved,
		Model:           outputModel,
	}); err != nil {
		return "", fmt.Errorf("snapshot save: %w", err)
	}
	completed = true

	if err := engine.ApproveSnapshot(ctx, app, strat, claimID); err != nil {
		return "", fmt.Errorf("reflection approve: %w", err)
	}

	logger().Info("stored reflection snapshot",
		"id", rec.Id, "name", rec.GetString("name"), "model", outputModel,
		"snapshot_id", claimID, "chars", len(outputStr), "duration", time.Since(started).Round(time.Millisecond))

	return claimID, nil
}
