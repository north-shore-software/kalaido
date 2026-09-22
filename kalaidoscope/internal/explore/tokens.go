// UNREVIEWED
package explore

import (
	"context"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// CountTokensForSpec estimates the token count for one context spec rendered
// as a fresh context, with the same chars/4 the guard uses.
func CountTokensForSpec(ctx context.Context, app core.App, spec api.ContextSpec, win *api.Window) int {
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, win)
	if err != nil {
		return 0
	}
	text, _ := llmcontext.HydrateDeltaToText(ctx, app, pinned, llmcontext.PinnedIDs{}, spec.WholeScope == api.WholeScopeSummaries)
	return llm.EstimateTokens(len(text))
}
