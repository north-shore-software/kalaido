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

func countTokensForSpec(ctx context.Context, app core.App, spec api.ContextSpec) int {
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec)
	if err != nil {
		return 0
	}
	text, _ := llmcontext.HydrateIDsToText(ctx, app, pinned)
	return len(text) / 4
}
