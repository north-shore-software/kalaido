package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// ApplyDraftLens executes a drafted lens against the hydrated sources — the
// exact call a future regeneration under a new lens makes, so what the user
// previews is what the lens actually reproduces.
//
// The preview is always generated from scratch. A drafted lens is by
// definition a changed lens, and the minimal-diff rewrite production
// regeneration applies (minimizeAgainstPrevious) is only valid when the same
// lens is re-run over new sources: its delta/merge prompts deliberately
// discard wording, ordering and formatting differences, which are precisely
// what a lens iteration is meant to change.
//
// Raw candidate text streams through onDelta as it generates; the returned
// string is the trimmed final output.
func ApplyDraftLens(ctx context.Context, app core.App, model, lensPrompt, sourceBlock string, onDelta func(string)) (string, error) {
	candidate, err := usage.GenerateStreamMsgs(ctx, app,
		[]llm.Message{{Role: "user", Content: prompts.ApplyPrompt(lensPrompt, sourceBlock, types.DateTime{}, types.DateTime{})}},
		llm.RoleSnapshot, model, onDelta)
	if err != nil {
		return "", fmt.Errorf("apply lens: %w", err)
	}
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", fmt.Errorf("apply lens: model returned empty output")
	}
	return candidate, nil
}
