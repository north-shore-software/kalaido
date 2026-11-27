package handlers

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// HandleProjectionRefinementChat executes one canvas-aware chat turn for a
// projection session under POST /api/projections/{id}/refinements/{rid}/chat.
func HandleProjectionRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return handleRefinementChatWith(
		app,
		schema.ColProjectionRefinement,
		"projection",
		projections.SessionParent,
		HandleProjectionChatForRefinement,
	)
}

// HandleReflectionRefinementChat executes one standing-lens authoring chat turn
// for a reflection under POST /api/reflections/{id}/refinements/{rid}/chat.
func HandleReflectionRefinementChat(app core.App) func(e *core.RequestEvent) error {
	return handleRefinementChatWith(
		app,
		schema.ColReflectionRefinement,
		"reflection",
		reflections.SessionParent,
		HandleReflectionChatForRefinement,
	)
}

func handleRefinementChatWith(
	app core.App,
	refinementCol schema.Collection,
	targetType string,
	resolveParent func(app core.App, refRec *core.Record) *core.Record,
	runner func(app core.App, req api.RefinementChatRequest, refRec *core.Record) func(e *core.RequestEvent) error,
) func(e *core.RequestEvent) error {
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
		if parent := resolveParent(app, refRec); parent == nil || parent.Id != parentID {
			return e.BadRequestError("refinement does not belong to specified "+targetType, nil)
		}

		req := api.RefinementChatRequest{}
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid chat request body", err)
		}
		if req.ID == "" {
			req.ID = refRec.GetString("external_conversation_id")
		}

		return runner(app, req, refRec)(e)
	}
}

// HandleProjectionChatForRefinement executes one canvas-aware chat turn for a
// resolved projection refinement record.
func HandleProjectionChatForRefinement(app core.App, req api.RefinementChatRequest, refRec *core.Record) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return mapRefinementStreamError(e, app, projections.StreamChatTurn(e.Request.Context(), app, req, refRec, e.Response))
	}
}

// HandleReflectionChatForRefinement executes one 1-step standing-lens authoring
// chat turn for a resolved reflection refinement record.
func HandleReflectionChatForRefinement(app core.App, req api.RefinementChatRequest, refRec *core.Record) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return mapRefinementStreamError(e, app, reflections.StreamChatTurn(e.Request.Context(), app, req, refRec, e.Response))
	}
}

func mapRefinementStreamError(e *core.RequestEvent, app core.App, err error) error {
	switch {
	case errors.Is(err, chat.ErrMessagesRequired):
		return e.BadRequestError("messages required", nil)
	case errors.Is(err, chat.ErrNoModel):
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
