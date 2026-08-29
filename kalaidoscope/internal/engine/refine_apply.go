package engine

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// ApplyDraftLens executes a drafted lens against the hydrated sources — the
// exact call a future regeneration makes, so what the user previews is what
// the lens actually reproduces. When a previous output exists, the candidate
// is rewritten as a minimal edit of it (the same delta/merge continuation
// production regeneration uses) so each turn's preview diffs quietly against
// the last.
//
// Raw candidate text streams through onDelta as it generates; the returned
// string is the final, possibly minimized, output and is authoritative — a
// caller relaying deltas into a live preview must replace them with it.
func ApplyDraftLens(ctx context.Context, app core.App, model, lensPrompt, sourceBlock, previous string, onDelta func(string)) (string, error) {
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

	previous = strings.TrimSpace(previous)
	if previous == "" || candidate == previous {
		return candidate, nil
	}

	merged, err := minimizeAgainstPrevious(ctx, app, model, lensPrompt, sourceBlock, previous, candidate)
	switch {
	case err == nil:
		return merged, nil
	case ctx.Err() != nil:
		// The turn is being abandoned; the raw candidate may itself be a
		// truncation. Abort rather than hand back half a document.
		return "", fmt.Errorf("minimal-diff rewrite: %w", context.Cause(ctx))
	default:
		// Same policy as production generation: the polish step failing must
		// not fail the apply — the raw candidate is correct, just noisier.
		log.Printf("refinement apply: minimal-diff rewrite failed, keeping raw candidate: %v", err)
		return candidate, nil
	}
}
