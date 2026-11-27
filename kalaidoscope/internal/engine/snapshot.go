package engine

import (
	"context"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// Sentinel values recorded in reflection_snapshot.generated_by_model for
// non-LLM origins (empty-window placeholder and direct manual text edits).
const (
	SnapshotModelEmpty  = "empty"
	SnapshotModelManual = "manual"
)

// IsSentinelModel reports whether model is a non-LLM origin sentinel rather
// than a real LLM model identifier.
func IsSentinelModel(model string) bool {
	return model == SnapshotModelEmpty || model == SnapshotModelManual
}

// GenerateOutput applies lensPrompt to sourceBlock for optional window win
// using RoleSnapshot and returns the trimmed model output.
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
