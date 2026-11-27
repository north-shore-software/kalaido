package handlers

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func HandleCreateProjectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		targetID := e.Request.PathValue("id")
		if targetID == "" {
			return e.BadRequestError("missing target id", nil)
		}

		var req api.CreateProjectionRefinementRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if req.ClientID == "" {
			return e.BadRequestError("missing clientId", nil)
		}

		refID, seeded, err := projections.CreateSession(app, req.ClientID, targetID, req.SnapshotID, req.ContextSpec)
		if err != nil {
			logger().Error("refinement create failed", "error", err)
			return e.InternalServerError("failed to create refinement", err)
		}

		return e.JSON(http.StatusCreated, api.CreateProjectionRefinementResponse{
			RefinementID: refID,
			Messages:     seeded,
		})
	}
}

func HandleCreateReflectionRefinement(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		targetID := e.Request.PathValue("id")
		if targetID == "" {
			return e.BadRequestError("missing target id", nil)
		}

		var req api.CreateReflectionRefinementRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if req.ClientID == "" {
			return e.BadRequestError("missing clientId", nil)
		}

		refID, seeded, err := reflections.CreateSession(app, req.ClientID, targetID, req.Window, req.ContextSpec)
		if err != nil {
			logger().Error("refinement create failed", "error", err)
			return e.InternalServerError("failed to create refinement", err)
		}

		return e.JSON(http.StatusCreated, api.CreateReflectionRefinementResponse{
			RefinementID: refID,
			Messages:     seeded,
		})
	}
}

func HandleCommitProjectionRefinement(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		rid := e.Request.PathValue("rid")
		if rid == "" {
			return e.BadRequestError("refinement id required", nil)
		}

		refRec, err := app.FindRecordById(schema.ColProjectionRefinement.String(), rid)
		if err != nil {
			return e.NotFoundError("refinement not found", err)
		}

		ctx := context.WithoutCancel(e.Request.Context())
		newSnapID, err := projections.CommitSession(ctx, app, refRec, e.Request.PathValue("id"), deps.Runner)
		if err != nil {
			switch {
			case errors.Is(err, chat.ErrMissingParentID), errors.Is(err, chat.ErrParentMismatch):
				return e.BadRequestError(err.Error(), nil)
			case errors.Is(err, chat.ErrNoPreviewOutput):
				return e.Error(http.StatusConflict, err.Error(), nil)
			case errors.Is(err, engine.ErrNotApprovable):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), nil)
			default:
				return e.InternalServerError("failed to commit refinement", err)
			}
		}

		return e.JSON(http.StatusOK, map[string]string{"snapshotId": newSnapID})
	}
}

func HandleCommitReflectionRefinement(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		rid := e.Request.PathValue("rid")
		if rid == "" {
			return e.BadRequestError("refinement id required", nil)
		}
		refRec, err := app.FindRecordById(schema.ColReflectionRefinement.String(), rid)
		if err != nil {
			return e.NotFoundError("refinement not found", err)
		}

		var req api.SaveReflectionRequest
		if e.Request != nil && e.Request.Body != nil && e.Request.ContentLength != 0 {
			if err := e.BindBody(&req); err != nil && !errors.Is(err, io.EOF) {
				return e.BadRequestError("invalid request body", err)
			}
		}

		ctx := context.WithoutCancel(e.Request.Context())
		lensID, err := reflections.CommitSession(ctx, app, refRec, e.Request.PathValue("id"), req, deps.Runner)
		if err != nil {
			switch {
			case errors.Is(err, reflections.ErrNotFound):
				return e.NotFoundError("reflection not found", err)
			case errors.Is(err, reflections.ErrInvalidWindowSpec),
				errors.Is(err, reflections.ErrEmptyLensPrompt),
				errors.Is(err, chat.ErrNoDraftedLens),
				errors.Is(err, chat.ErrMissingParentID),
				errors.Is(err, chat.ErrParentMismatch):
				return e.BadRequestError(err.Error(), nil)
			case errors.Is(err, chat.ErrNoPreviewOutput):
				return e.Error(http.StatusConflict, err.Error(), nil)
			default:
				return e.InternalServerError("failed to commit refinement", err)
			}
		}

		return e.JSON(http.StatusOK, api.SaveReflectionResponse{
			ID:         e.Request.PathValue("id"),
			LensID:     lensID,
			SnapshotID: "",
		})
	}
}
