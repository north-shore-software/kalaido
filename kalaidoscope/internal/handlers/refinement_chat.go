package handlers

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// Backward-compatibility aliases for tests and internal/handlers callers.
var (
	updateLensTool  = refinement.UpdateLensTool
	suggestNameTool = refinement.SuggestNameTool
	toolCallPart    = chat.ToolCallPart
)

// HandleProjectionRefinementChat handles drafting chat turns for projection refinements under
// POST /api/projections/{id}/refinements/{rid}/chat.
func HandleProjectionRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projID := e.Request.PathValue("id")
		rid := e.Request.PathValue("rid")
		if projID == "" || rid == "" {
			return e.BadRequestError("projection id and refinement id required", nil)
		}

		refRec, err := app.FindRecordById(schema.ColProjectionRefinement.String(), rid)
		if err != nil {
			return e.NotFoundError("projection refinement not found", err)
		}

		if parent := refinement.Parent(app, refRec); parent == nil || parent.Id != projID {
			return e.BadRequestError("refinement does not belong to specified projection", nil)
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

// HandleReflectionRefinementChat handles drafting chat turns for reflection refinements under
// POST /api/reflections/{id}/refinements/{rid}/chat.
func HandleReflectionRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		reflID := e.Request.PathValue("id")
		rid := e.Request.PathValue("rid")
		if reflID == "" || rid == "" {
			return e.BadRequestError("reflection id and refinement id required", nil)
		}

		refRec, err := app.FindRecordById(schema.ColReflectionRefinement.String(), rid)
		if err != nil {
			return e.NotFoundError("reflection refinement not found", err)
		}

		if parent := refinement.Parent(app, refRec); parent == nil || parent.Id != reflID {
			return e.BadRequestError("refinement does not belong to specified reflection", nil)
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

// HandleRefinementChat handles drafting chat turns directly for projection and
// reflection refinements under POST /api/refinements/chat.
func HandleRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		req := api.RefinementChatRequest{}
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid chat request body", err)
		}
		if req.ID == "" {
			return e.BadRequestError("refinement conversation id required", nil)
		}

		refRec, err := refinement.Find(app, req.ID)
		if err != nil {
			return e.NotFoundError("refinement conversation not found", nil)
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
			logger(app).Warn("refinement chat prompt too large", "refinement_id", refRec.Id, "error", err)
			return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
		}

		if err != nil {
			return e.InternalServerError("llm stream failed", err)
		}

		return nil
	}
}
