package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
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

		refID, seeded, err := refinement.CreateProjectionRefinement(app, req.ClientID, targetID, req.SnapshotID, req.ContextSpec)
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

		refID, seeded, err := refinement.CreateReflectionRefinement(app, req.ClientID, targetID, req.Window, req.ContextSpec)
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
	return handleCommitRefinementGeneric(app, deps, schema.ColProjectionRefinement.String())
}

func HandleCommitReflectionRefinement(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return handleCommitRefinementGeneric(app, deps, schema.ColReflectionRefinement.String())
}

func handleCommitRefinementGeneric(app core.App, deps Deps, refinementColName string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		rid := e.Request.PathValue("rid")
		if rid == "" {
			return e.BadRequestError("refinement id required", nil)
		}

		refRec, err := app.FindRecordById(refinementColName, rid)
		if err != nil {
			return e.NotFoundError("refinement not found", err)
		}

		ctx := context.WithoutCancel(e.Request.Context())
		newSnapID, err := refinement.Commit(ctx, app, refRec, e.Request.PathValue("id"), deps.Runner, deps.Reconcile.EnqueueWave)
		if err != nil {
			switch {
			case errors.Is(err, refinement.ErrNoDraftedLens):
				return e.BadRequestError(err.Error(), nil)
			case errors.Is(err, refinement.ErrNoPreviewOutput):
				return e.Error(http.StatusConflict, err.Error(), nil)
			case errors.Is(err, refinement.ErrMissingParentID), errors.Is(err, refinement.ErrParentMismatch):
				return e.BadRequestError(err.Error(), nil)
			default:
				return e.InternalServerError("failed to commit refinement", err)
			}
		}

		return e.JSON(http.StatusOK, map[string]string{"snapshotId": newSnapID})
	}
}
