// UNREVIEWED
package handlers

import (
	"context"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/explore"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// HandleResolveTokens estimates what a spec would put in front of the model,
// per item, and whether that fits the chat model's prompt budget — the context
// bar's pre-flight for offering whole scope in full.
//
// With a conversationId the estimate is the whole next turn of that chat
// instead — system prompt, context and transcript — against the model the
// conversation would actually use; the chat's context meter reads this.
func HandleResolveTokens(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body api.TokenResolutionRequest
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid JSON body", err)
		}
		spec, win := body.ContextSpec, body.Window
		if win != nil && (win.Start == "" || win.End == "") {
			win = nil
		}

		ctx := e.Request.Context()
		if body.ConversationID != "" {
			return resolvePromptTokens(e, app, body.ConversationID, spec, win)
		}
		res := api.TokenResolutionResponse{
			Breakdown: make(map[string]int),
		}
		add := func(key string, tokens int) {
			res.TotalTokens += tokens
			res.Breakdown[key] = tokens
		}

		if spec.WholeScope != "" {
			add("WholeScope", countTokensForSpec(ctx, app, api.ContextSpec{WholeScope: spec.WholeScope}, win))
		}

		// Pins render in full whatever the mode. Under whole scope in full
		// the fragment-level pins are already counted, so only the snapshot
		// pins add; under summaries every pin is extra.
		countFragmentPins := spec.WholeScope == "" || spec.WholeScope == api.WholeScopeSummaries
		if countFragmentPins {
			for _, fid := range spec.FragmentIDs {
				add("Fragment:"+fid, countTokensForSpec(ctx, app, api.ContextSpec{FragmentIDs: []string{fid}}, win))
			}
			for _, ft := range spec.FragmentTypes {
				add("Type:"+ft, countTokensForSpec(ctx, app, api.ContextSpec{FragmentTypes: []string{ft}}, win))
			}
			for _, cid := range spec.ColourIDs {
				add("Colour:"+cid, countTokensForSpec(ctx, app, api.ContextSpec{ColourIDs: []string{cid}}, win))
			}
		}
		for _, pid := range spec.SourceProjectionIDs {
			add("Projection:"+pid, countTokensForSpec(ctx, app, api.ContextSpec{SourceProjectionIDs: []string{pid}}, win))
		}
		for _, rid := range spec.SourceReflectionIDs {
			add("Reflection:"+rid, countTokensForSpec(ctx, app, api.ContextSpec{SourceReflectionIDs: []string{rid}}, win))
		}

		if model, err := llm.ResolveRoleFor(llm.RoleChat, ""); err == nil {
			res.Model = model
			res.Limit = llm.PromptBudget(model)
		}
		res.Fits = res.Limit <= 0 || res.TotalTokens <= res.Limit

		return e.JSON(http.StatusOK, res)
	}
}

// resolvePromptTokens answers the conversation form: the next turn's prompt,
// split into what the transcript is made of. The conversation's own model
// override wins here, as it does on the turn itself.
func resolvePromptTokens(e *core.RequestEvent, app core.App, clientID string, spec api.ContextSpec, win *api.Window) error {
	est, err := explore.EstimatePrompt(e.Request.Context(), app, clientID, &spec, win)
	if err != nil {
		return e.InternalServerError("estimate failed", err)
	}
	res := api.TokenResolutionResponse{
		TotalTokens: est.Total(),
		Breakdown: map[string]int{
			"System":     est.System,
			"Context":    est.Context,
			"Transcript": est.Transcript,
		},
	}
	if model, err := llm.ResolveRoleFor(llm.RoleChat, est.Model); err == nil {
		res.Model = model
		res.Limit = llm.PromptBudget(model)
	}
	res.Fits = res.Limit <= 0 || res.TotalTokens <= res.Limit
	return e.JSON(http.StatusOK, res)
}

// countTokensForSpec is the estimate for one spec rendered as a fresh context,
// with the same chars/4 the guard uses.
func countTokensForSpec(ctx context.Context, app core.App, spec api.ContextSpec, win *api.Window) int {
	pinned, err := llmcontext.ResolveSpecToIDs(ctx, app, spec, win)
	if err != nil {
		return 0
	}
	text, _ := llmcontext.HydrateDeltaToText(ctx, app, pinned, llmcontext.PinnedIDs{}, spec.WholeScope == api.WholeScopeSummaries)
	return llm.EstimateTokens(len(text))
}
