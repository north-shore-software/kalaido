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
		// The spec's own fields plus an optional window: a reflection's
		// context bar counts only what falls inside its target window.
		var body struct {
			api.ContextSpec
			Window *api.Window `json:"window,omitempty"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid JSON body", err)
		}
		spec, win := body.ContextSpec, body.Window
		if win != nil && (win.Start == "" || win.End == "") {
			win = nil
		}

		ctx := e.Request.Context()
		res := api.TokenResolutionResponse{
			Breakdown: make(map[string]int),
		}

		if spec.WholeScope {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{WholeScope: true, Summaries: spec.Summaries}, win)
			res.TotalTokens = tokens
			res.Breakdown["WholeScope"] = tokens
			return e.JSON(http.StatusOK, res)
		}

		totalTokens := 0

		for _, fid := range spec.FragmentIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{FragmentIDs: []string{fid}}, win)
			totalTokens += tokens
			res.Breakdown["Fragment:"+fid] = tokens
		}

		for _, ft := range spec.FragmentTypes {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{FragmentTypes: []string{ft}}, win)
			totalTokens += tokens
			res.Breakdown["Type:"+ft] = tokens
		}

		for _, cid := range spec.ColourIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{ColourIDs: []string{cid}}, win)
			totalTokens += tokens
			res.Breakdown["Colour:"+cid] = tokens
		}

		for _, pid := range spec.SourceProjectionIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{SourceProjectionIDs: []string{pid}}, win)
			totalTokens += tokens
			res.Breakdown["Projection:"+pid] = tokens
		}

		for _, rid := range spec.SourceReflectionIDs {
			tokens := countTokensForSpec(ctx, app, api.ContextSpec{SourceReflectionIDs: []string{rid}}, win)
			totalTokens += tokens
			res.Breakdown["Reflection:"+rid] = tokens
		}

		res.TotalTokens = totalTokens

		return e.JSON(http.StatusOK, res)
	}
}

func countTokensForSpec(ctx context.Context, app core.App, spec api.ContextSpec, win *api.Window) int {
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, win)
	if err != nil {
		return 0
	}
	var text string
	if spec.Summaries {
		text, _ = llmcontext.HydrateDeltaToText(ctx, app, pinned, llmcontext.PinnedIDs{}, true)
	} else {
		text, _ = llmcontext.HydrateIDsToText(ctx, app, pinned)
	}
	return len(text) / 4
}
