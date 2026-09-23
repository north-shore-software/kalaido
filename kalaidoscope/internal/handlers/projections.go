package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

func HandleCreateProjection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.CreateProjectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		target, err := projections.Create(app, projections.CreateParams{
			Name:        req.Name,
			Description: req.Description,
		})
		if err != nil {
			logger().Error("create projection failed", "error", err)
			return e.InternalServerError("create projection failed", err)
		}

		logger().Info("created projection", "id", target.Id)
		return e.JSON(http.StatusCreated, api.CreateProjectionResponse{ProjectionID: target.Id})
	}
}

func HandleUpdateProjection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		var req api.UpdateProjectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		authID := ""
		if e.Auth != nil {
			authID = e.Auth.Id
		}

		_, err := projections.Update(app, id, projections.UpdateParams{
			Name:              req.Name,
			GenerateWithModel: req.GenerateWithModel,
			Pinned:            req.Pinned,
			AuthID:            authID,
		})
		if err != nil {
			if errors.Is(err, projections.ErrNotFound) {
				return e.NotFoundError("projection not found", err)
			}
			logger().Error("update projection failed", "error", err)
			return e.InternalServerError("update projection failed", err)
		}

		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

func HandleDeleteProjection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		err := projections.Delete(app, id)
		if err != nil {
			switch {
			case errors.Is(err, projections.ErrNotFound):
				return e.NotFoundError("projection not found", err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "a generation is running for this projection", nil)
			default:
				logger().Error("delete projection failed", "id", id, "error", err)
				return e.InternalServerError("delete projection failed", err)
			}
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func HandleRestoreProjection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		_, err := projections.Restore(app, id)
		if err != nil {
			if errors.Is(err, projections.ErrNotFound) {
				return e.NotFoundError("projection not found", err)
			}
			logger().Error("restore projection failed", "id", id, "error", err)
			return e.InternalServerError("restore projection failed", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

func HandleGenerateCandidate(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		var req api.GenerateProjectionSnapshotRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		status := engine.StatusApproved
		if req.Preview {
			status = engine.StatusPending
		}

		_, err := projections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("projection not found", err)
		}

		st, err := reconcile.EvaluateEntity(e.Request.Context(), app, id)
		if err != nil {
			logger().Warn("staleness check failed", "target_type", "projection", "error", err)
		} else if len(st.BlockedBy) > 0 {
			return e.Error(http.StatusConflict, "upstream dependencies are not up to date; approve them first", nil)
		}

		// The generation outlives the request; only waiting on another run
		// is bounded by it.
		snapID, err := deps.GenerateProjectionSnapshot(context.WithoutCancel(e.Request.Context()), e.Request.Context(), id, status)
		if err != nil {
			return WriteGenerateError(e, app, err, "projection")
		}

		return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{SnapshotID: snapID})
	}
}

func HandleApproveCandidate(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app)
		if herr != nil {
			return herr
		}
		if err := projections.Approve(e.Request.Context(), app, snapID); err != nil {
			logger().Error("approve failed", "target_type", "projection", "error", err)
			if errors.Is(err, engine.ErrNotApprovable) {
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
			return e.InternalServerError("approve failed", err)
		}
		deps.Reconcile.EnqueueWave()
		return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{SnapshotID: snapID})
	}
}

func HandleEditCandidate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app)
		if herr != nil {
			return herr
		}
		var req api.EditCandidateRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if req.OldText == "" {
			return e.BadRequestError("oldText required", nil)
		}
		res, err := projections.ApplyEdit(context.WithoutCancel(e.Request.Context()), app,
			e.Request.PathValue("id"), snapID, req.OldText, req.NewText)
		if err != nil {
			logger().Error("edit failed", "target_type", "projection", "error", err)
			switch {
			case errors.Is(err, projections.ErrEditNotPending):
				return e.Error(http.StatusConflict, err.Error(), err)
			case errors.Is(err, projections.ErrEditRejected):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
			return e.InternalServerError("edit failed", err)
		}
		return e.JSON(http.StatusOK, api.EditCandidateResponse{SnapshotID: res.SnapshotID, FragmentID: res.FragmentID})
	}
}
