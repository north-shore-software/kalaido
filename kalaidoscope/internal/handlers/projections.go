package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
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

func HandleGenerateCandidate(app core.App, runner workerutil.Runner) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		var req api.GenerateProjectionSnapshotRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		if _, err := projections.FindLive(app, id); err != nil {
			return e.NotFoundError("projection not found", err)
		}

		if req.Async {
			claimID, err := projections.StartAnchoredUpdateAsync(app, runner, id, req.DiscardExisting)
			if err != nil {
				return WriteGenerateError(e, app, err, "projection")
			}
			return e.JSON(http.StatusAccepted, api.ProjectionSnapshotResponse{
				SnapshotID: claimID,
			})
		}

		genCtx := context.WithoutCancel(e.Request.Context())
		proj, claimID, err := projections.PrepareAnchoredUpdate(genCtx, app, id, req.DiscardExisting)
		if err != nil {
			return WriteGenerateError(e, app, err, "projection")
		}
		res, err := projections.ExecuteClaimedUpdate(genCtx, app, proj, claimID)
		if err != nil {
			return WriteGenerateError(e, app, err, "projection")
		}

		return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{
			SnapshotID:   res.SnapshotID,
			RefinementID: res.RefinementID,
		})
	}
}

func HandleGetCandidateStatus(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projID := e.Request.PathValue("id")
		snapID := e.Request.PathValue("rid")
		if projID == "" || snapID == "" {
			return e.BadRequestError("projection id and candidate id required", nil)
		}
		res, err := projections.GetCandidateUpdateStatus(app, projID, snapID)
		if err != nil {
			if errors.Is(err, projections.ErrNotFound) {
				return e.NotFoundError("projection or candidate not found", err)
			}
			logger().Error("get candidate status failed", "id", projID, "snapshot_id", snapID, "error", err)
			return e.InternalServerError("get candidate status failed", err)
		}
		return e.JSON(http.StatusOK, res)
	}
}

func HandleApproveCandidate(app core.App, runner workerutil.Runner) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app)
		if herr != nil {
			return herr
		}
		projID := e.Request.PathValue("id")
		if _, err := projections.SaveCandidate(context.WithoutCancel(e.Request.Context()), app, runner, projID, snapID, nil); err != nil {
			logger().Error("approve failed", "target_type", "projection", "error", err)
			if errors.Is(err, engine.ErrNotApprovable) {
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
			if errors.Is(err, projections.ErrNotFound) {
				return e.NotFoundError("projection not found", err)
			}
			return e.InternalServerError("approve failed", err)
		}
		return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{SnapshotID: snapID})
	}
}

func HandleGetProjectionLens(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		res, err := projections.ReadLens(app, id)
		if err != nil {
			if errors.Is(err, projections.ErrNotFound) {
				return e.NotFoundError("projection not found", err)
			}
			return e.InternalServerError("read projection lens failed", err)
		}
		return e.JSON(http.StatusOK, res)
	}
}

func HandleUpdateProjectionLens(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		var req api.UpdateProjectionLensRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if strings.TrimSpace(req.Prompt) == "" {
			return e.BadRequestError("prompt required", nil)
		}
		res, err := projections.UpdateLens(app, id, req.Prompt)
		if err != nil {
			if errors.Is(err, projections.ErrNotFound) {
				return e.NotFoundError("projection not found", err)
			}
			return e.InternalServerError("update projection lens failed", err)
		}
		return e.JSON(http.StatusOK, res)
	}
}

func HandleStartProjectionRevise(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		var req api.StartProjectionReviseRequest
		_ = e.BindBody(&req)

		res, err := projections.StartReviseSession(context.WithoutCancel(e.Request.Context()), app, id, req.ClientID)
		if err != nil {
			switch {
			case errors.Is(err, projections.ErrNotFound):
				return e.NotFoundError("projection not found", err)
			case errors.Is(err, projections.ErrNoApprovedSnapshot):
				return e.Error(http.StatusConflict, err.Error(), err)
			default:
				logger().Error("start projection revise failed", "id", id, "error", err)
				return e.InternalServerError("start projection revise failed", err)
			}
		}
		return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{
			SnapshotID:   res.SnapshotID,
			RefinementID: res.RefinementID,
		})
	}
}

func HandleDiscardCandidate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app)
		if herr != nil {
			return herr
		}
		projID := e.Request.PathValue("id")
		res, err := projections.DiscardCandidate(app, projID, snapID)
		if err != nil {
			switch {
			case errors.Is(err, projections.ErrNotFound):
				return e.NotFoundError("projection not found", err)
			case errors.Is(err, projections.ErrEditNotPending):
				return e.Error(http.StatusConflict, err.Error(), err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "a generation is running for this projection", nil)
			default:
				logger().Error("discard candidate failed", "id", projID, "snapshot_id", snapID, "error", err)
				return e.InternalServerError("discard candidate failed", err)
			}
		}
		return e.JSON(http.StatusOK, api.DiscardProjectionResponse{
			SnapshotID:         snapID,
			DeletedProjection:  res.DeletedProjection,
			RevertedToProposed: res.RevertedToProposed,
		})
	}
}

func HandleDiscardProjectionDraft(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projID := e.Request.PathValue("id")
		if projID == "" {
			return e.BadRequestError("id required", nil)
		}
		res, err := projections.DiscardDraftSession(app, projID)
		if err != nil {
			switch {
			case errors.Is(err, projections.ErrNotFound):
				return e.NotFoundError("projection not found", err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "a generation is running for this projection", nil)
			default:
				logger().Error("discard projection draft failed", "id", projID, "error", err)
				return e.InternalServerError("discard projection draft failed", err)
			}
		}
		return e.JSON(http.StatusOK, api.DiscardProjectionResponse{
			DeletedProjection:  res.DeletedProjection,
			RevertedToProposed: res.RevertedToProposed,
		})
	}
}

func HandleResolveAllSnapshotEdits(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app)
		if herr != nil {
			return herr
		}
		var req api.ResolveAllSnapshotEditsRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		edits, err := projections.ResolveAllSnapshotEdits(
			context.WithoutCancel(e.Request.Context()),
			app,
			e.Request.PathValue("id"),
			snapID,
			req.Status,
		)
		if err != nil {
			logger().Error("resolve all edits failed", "target_type", "projection", "error", err)
			switch {
			case errors.Is(err, projections.ErrInvalidEditStatus):
				return e.BadRequestError(err.Error(), err)
			case errors.Is(err, projections.ErrEditNotPending):
				return e.Error(http.StatusConflict, err.Error(), err)
			case errors.Is(err, projections.ErrEditRejected):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			default:
				return e.InternalServerError("resolve all edits failed", err)
			}
		}
		return e.JSON(http.StatusOK, api.ResolveAllSnapshotEditsResponse{Edits: edits})
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
		res, err := projections.ApplyEdit(context.WithoutCancel(e.Request.Context()), app,
			e.Request.PathValue("id"), snapID, req.BlockPosition, req.NewText)
		if err != nil {
			logger().Error("edit failed", "target_type", "projection", "error", err)
			switch {
			case errors.Is(err, projections.ErrInvalidBlockPosition):
				return e.BadRequestError(err.Error(), err)
			case errors.Is(err, projections.ErrEditNotPending), errors.Is(err, projections.ErrEditUnderMarker):
				return e.Error(http.StatusConflict, err.Error(), err)
			case errors.Is(err, projections.ErrEditRejected):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
			return e.InternalServerError("edit failed", err)
		}
		return e.JSON(http.StatusOK, api.EditCandidateResponse{FragmentID: res.FragmentID, Edit: res.Edit})
	}
}

func HandleUpdateSnapshotEditStatus(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app)
		if herr != nil {
			return herr
		}
		editID := e.Request.PathValue("eid")
		if editID == "" {
			return e.BadRequestError("edit id required", nil)
		}
		var req api.UpdateSnapshotEditStatusRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		updated, err := projections.UpdateSnapshotEditStatus(context.WithoutCancel(e.Request.Context()), app,
			e.Request.PathValue("id"), snapID, editID, req.Status)
		if err != nil {
			logger().Error("update snapshot edit status failed", "target_type", "projection", "error", err)
			switch {
			case errors.Is(err, projections.ErrInvalidEditStatus):
				return e.BadRequestError(err.Error(), err)
			case errors.Is(err, projections.ErrEditNotFound):
				return e.NotFoundError(err.Error(), err)
			case errors.Is(err, projections.ErrEditNotPending), errors.Is(err, projections.ErrEditNotUndoable), errors.Is(err, projections.ErrEditAlreadyResolved):
				return e.Error(http.StatusConflict, err.Error(), err)
			case errors.Is(err, projections.ErrEditRejected):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
			return e.InternalServerError("update snapshot edit status failed", err)
		}
		return e.JSON(http.StatusOK, api.UpdateSnapshotEditStatusResponse{Edit: updated})
	}
}
