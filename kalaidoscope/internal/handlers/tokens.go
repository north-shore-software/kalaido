package handlers

import (
	"context"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
)

func HandleResolveTokens(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var spec api.ContextSpec
		if err := e.BindBody(&spec); err != nil {
			return e.BadRequestError("Invalid JSON body", err)
		}

		ctx := e.Request.Context()
		res := api.TokenResolutionResponse{
			Breakdown: make(map[string]int),
		}

		// What a context costs depends on what's in it, not on how it's framed,
		// so price the focus and the background as one set. Flattening here also
		// keeps every selected item present in the breakdown, which callers cache
		// by item — a focused item missing from it would be re-priced forever.
		spec = flattenFocus(spec)

		if spec.WholeScope {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{WholeScope: true})
			res.TotalTokens = tokens
			res.Breakdown["WholeScope"] = tokens
			return e.JSON(http.StatusOK, res)
		}

		totalTokens := 0

		for _, fid := range spec.FragmentIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{FragmentIDs: []string{fid}})
			totalTokens += tokens
			res.Breakdown["Fragment:"+fid] = tokens
		}

		for _, ft := range spec.FragmentTypes {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{FragmentTypes: []string{ft}})
			totalTokens += tokens
			res.Breakdown["Type:"+ft] = tokens
		}

		for _, cid := range spec.ColourIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{ColourIDs: []string{cid}})
			totalTokens += tokens
			res.Breakdown["Colour:"+cid] = tokens
		}

		for _, pid := range spec.SourceProjectionIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{SourceProjectionIDs: []string{pid}})
			totalTokens += tokens
			res.Breakdown["Projection:"+pid] = tokens
		}

		for _, rid := range spec.SourceReflectionIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{SourceReflectionIDs: []string{rid}})
			totalTokens += tokens
			res.Breakdown["Reflection:"+rid] = tokens
		}

		res.TotalTokens = totalTokens

		return e.JSON(http.StatusOK, res)
	}
}

// flattenFocus folds a spec's focus back into it, without repeating anything
// named by both halves.
func flattenFocus(spec api.ContextSpec) api.ContextSpec {
	if spec.Focus == nil {
		return spec
	}
	focus := *spec.Focus
	out := spec
	out.Focus = nil
	out.WholeScope = spec.WholeScope || focus.WholeScope
	out.FragmentIDs = mergeUnique(spec.FragmentIDs, focus.FragmentIDs)
	out.FragmentTypes = mergeUnique(spec.FragmentTypes, focus.FragmentTypes)
	out.ColourIDs = mergeUnique(spec.ColourIDs, focus.ColourIDs)
	out.SourceProjectionIDs = mergeUnique(spec.SourceProjectionIDs, focus.SourceProjectionIDs)
	out.SourceReflectionIDs = mergeUnique(spec.SourceReflectionIDs, focus.SourceReflectionIDs)
	return out
}

func mergeUnique(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, s := range append(append([]string(nil), a...), b...) {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func countTokensForSpec(ctx context.Context, app core.App, spec api.ContextSpec) int {
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec)
	if err != nil {
		return 0
	}
	text, _ := llmcontext.HydrateIDsToText(ctx, app, pinned)
	return len(text) / 4
}
