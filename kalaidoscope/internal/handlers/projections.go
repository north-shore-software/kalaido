package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
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

		// A generation discards the pending candidate it replaces, so an
		// engaged one (hand edits, chat proposals, an open refinement) is
		// only replaced when the client says so explicitly. The evaluator
		// reports engagement alongside blocking; if it fails, the engagement
		// check still runs on its own — a warning must not turn into lost
		// edits.
		engaged := false
		st, err := reconcile.EvaluateEntity(e.Request.Context(), app, id)
		if err != nil {
			logger().Warn("staleness check failed", "target_type", "projection", "error", err)
			if cand, cerr := engine.FindPendingCandidate(app, projections.Strategy{}, id, nil); cerr == nil && cand != nil {
				engaged, _ = engine.CandidateEngaged(app, projections.Strategy{}, cand)
			}
		} else if len(st.BlockedBy) > 0 {
			return e.Error(http.StatusConflict, "upstream dependencies are not up to date; approve them first", nil)
		} else if st.Candidate != nil {
			engaged = st.Candidate.Engaged
		}
		if engaged && !req.DiscardEngaged {
			return e.Error(http.StatusConflict, "cannot replace engaged candidate; discard it first", map[string]any{"kind": "candidate_engaged"})
		}

		genCtx := context.WithoutCancel(e.Request.Context())
		if req.FoldIn {
			// Fold-in: the user approved and asked to bring the projection up
			// to date, not to see the result — a no-change regeneration
			// settles in place rather than parking an identical candidate.
			genCtx = llmcontext.WithSettleUnchanged(genCtx)
		}

		// The generation outlives the request; only waiting on another run
		// is bounded by it.
		snapID, err := deps.GenerateProjectionSnapshot(genCtx, e.Request.Context(), id, status)
		if err != nil {
			return WriteGenerateError(e, app, err, "projection")
		}

		// The conversation the reader had on the candidate they just approved
		// follows them onto the folded-in one; a blank chat after a fold-in
		// reads as lost work. Best effort: the candidate is already made.
		if req.FoldIn && req.Preview {
			if _, err := refinement.CarryOpenRefinementToCandidate(genCtx, app, id, snapID); err != nil {
				logger().Warn("fold-in: could not carry the refinement to the new candidate", "projection_id", id, "snapshot_id", snapID, "error", err)
			}
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
