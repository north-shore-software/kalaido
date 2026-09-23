package handlers

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// HandleProjectionRefinementChat drafts one chat turn for a projection
// refinement under POST /api/projections/{id}/refinements/{rid}/chat.
func HandleProjectionRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return handleRefinementChat(app, schema.ColProjectionRefinement, "projection")
}

// HandleReflectionRefinementChat drafts one chat turn for a reflection
// refinement under POST /api/reflections/{id}/refinements/{rid}/chat.
func HandleReflectionRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return handleRefinementChat(app, schema.ColReflectionRefinement, "reflection")
}

// handleRefinementChat resolves {rid} in refinementCol, checks it belongs to
// the {id} parent, and streams the turn.
func handleRefinementChat(app core.App, refinementCol schema.Collection, targetType string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		parentID := e.Request.PathValue("id")
		rid := e.Request.PathValue("rid")
		if parentID == "" || rid == "" {
			return e.BadRequestError(targetType+" id and refinement id required", nil)
		}

		refRec, err := app.FindRecordById(refinementCol.String(), rid)
		if err != nil {
			return e.NotFoundError(targetType+" refinement not found", err)
		}
		if parent := refinement.Parent(app, refRec); parent == nil || parent.Id != parentID {
			return e.BadRequestError("refinement does not belong to specified "+targetType, nil)
		}

		req := api.RefinementChatRequest{}
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid chat request body", err)
		}
		if req.ID == "" {
			req.ID = refRec.GetString("external_conversation_id")
		}

		return HandleChatForRefinement(app, req, refRec)(e)
	}
}

// HandleChatForRefinement executes one turn of refinement chat for a resolved refinement record.
func HandleChatForRefinement(app core.App, req api.RefinementChatRequest, refRec *core.Record) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		err := refinement.StreamTurn(e.Request.Context(), app, req, refRec, e.Response)
		switch {
		case errors.Is(err, refinement.ErrMessagesRequired):
			return e.BadRequestError("messages required", nil)
		case errors.Is(err, refinement.ErrNoModel):
			return e.InternalServerError("no model configured for refinement", err)
		case errors.Is(err, usage.ErrExhausted):
			return usage.WriteExhausted(e, app)
		case usage.WriteProviderError(e, err):
			return nil
		}

		var tooLarge *llm.ContextTooLargeError
		if errors.As(err, &tooLarge) {
			return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
		}

		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		return nil
	}
}
