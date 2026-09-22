// UNREVIEWED
package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func HandleCreateProjection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.CreateProjectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		var targetID string
		err := app.RunInTransaction(func(txApp core.App) error {
			col, err := txApp.FindCollectionByNameOrId(schema.ColProjection.String())
			if err != nil {
				return err
			}
			rec := core.NewRecord(col)
			rec.Set("name", req.Name)
			rec.Set("status", engine.EntityActive)
			if d := strings.TrimSpace(req.Description); d != "" {
				rec.Set("description", d)
			}
			if err := txApp.Save(rec); err != nil {
				return err
			}
			targetID = rec.Id
			return nil
		})
		if err != nil {
			logger(app).Error("create projection failed", "error", err)
			return e.InternalServerError("create projection failed", err)
		}

		logger(app).Info("created projection", "id", targetID)
		return e.JSON(http.StatusCreated, api.CreateProjectionResponse{ProjectionID: targetID})
	}
}

func HandleUpdateProjection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		rec, err := engine.FindLive(app, engine.ProjectionStrategy{}, id)
		if err != nil {
			return e.NotFoundError("projection not found", err)
		}

		var req api.UpdateProjectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		if req.Name != nil {
			rec.Set("name", *req.Name)
		}
		if req.GenerateWithModel != nil {
			rec.Set("generate_with_model", *req.GenerateWithModel)
		}
		if req.Pinned != nil && e.Auth != nil {
			pinnedBy := rec.GetStringSlice("pinned_by")
			var newPinnedBy []string
			if *req.Pinned {
				hasUser := false
				for _, uid := range pinnedBy {
					if uid == e.Auth.Id {
						hasUser = true
					}
					newPinnedBy = append(newPinnedBy, uid)
				}
				if !hasUser {
					newPinnedBy = append(newPinnedBy, e.Auth.Id)
				}
			} else {
				for _, uid := range pinnedBy {
					if uid != e.Auth.Id {
						newPinnedBy = append(newPinnedBy, uid)
					}
				}
			}
			rec.Set("pinned_by", newPinnedBy)
		}

		if err := app.Save(rec); err != nil {
			logger(app).Error("update projection failed", "error", err)
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

		rec, err := app.FindRecordById(schema.ColProjection.String(), id)
		if err != nil {
			return e.NotFoundError("projection not found", err)
		}
		if engine.IsDeleted(rec) {
			return e.NoContent(http.StatusNoContent)
		}

		inFlight, err := engine.HasLiveClaim(app, engine.ProjectionStrategy{}, id)
		if err != nil {
			logger(app).Error("delete projection failed", "id", id, "error", err)
			return e.InternalServerError("delete projection failed", err)
		}
		if inFlight {
			return e.Error(http.StatusConflict, "a generation is running for this projection", nil)
		}

		err = app.RunInTransaction(func(tx core.App) error {
			for _, collection := range []string{"projection", "reflection"} {
				if err := scrubIDFromSpecs(tx, collection, sourceProjectionIDs, id); err != nil {
					return err
				}
			}
			return engine.SoftDelete(tx, rec)
		})
		if err != nil {
			logger(app).Error("delete projection failed", "id", id, "error", err)
			return e.InternalServerError("delete projection failed", err)
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
		rec, err := app.FindRecordById(schema.ColProjection.String(), id)
		if err != nil {
			return e.NotFoundError("projection not found", err)
		}
		if err := engine.Restore(app, rec); err != nil {
			logger(app).Error("restore projection failed", "id", id, "error", err)
			return e.InternalServerError("restore projection failed", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

func resolveCandidate(e *core.RequestEvent, app core.App) (string, error) {
	id := e.Request.PathValue("id")
	if id == "" {
		return "", e.BadRequestError("projection id required", nil)
	}
	rid := e.Request.PathValue("rid")
	if rid == "" {
		return "", e.BadRequestError("candidate id required", nil)
	}
	snap, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), rid)
	if err != nil {
		return "", e.NotFoundError("candidate not found", err)
	}
	if snap.GetString("projection_id") != id {
		return "", e.NotFoundError("candidate does not belong to this projection", nil)
	}
	return rid, nil
}

func HandleGenerateCandidate(app core.App) func(e *core.RequestEvent) error {
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

		_, err := engine.FindLive(app, engine.ProjectionStrategy{}, id)
		if err != nil {
			return e.NotFoundError("projection not found", err)
		}

		st, err := entityStatus(e.Request.Context(), app, id)
		if err != nil {
			logger(app).Warn("staleness check failed", "target_type", "projection", "error", err)
		} else if len(st.BlockedBy) > 0 {
			return e.Error(http.StatusConflict, "upstream dependencies are not up to date; approve them first", nil)
		}

		genCtx := context.WithoutCancel(e.Request.Context())
		snapID, err := engine.GenerateSnapshot(genCtx, app, id, status, engine.ProjectionStrategy{}, nil)
		if errors.Is(err, engine.ErrGenerationInFlight) {
			snapID, err = joinGeneration(e.Request.Context(), app, engine.ProjectionStrategy{}, id, nil)
			if errors.Is(err, engine.ErrGenerationAbandoned) {
				snapID, err = engine.GenerateSnapshot(genCtx, app, id, status, engine.ProjectionStrategy{}, nil)
			}
		}

		switch {
		case errors.Is(err, usage.ErrExhausted):
			return usage.WriteExhausted(e, app)
		case errors.Is(err, engine.ErrLensNotReady):
			return e.Error(http.StatusConflict, "This projection's lens is still being prepared — try again in a moment.", err)
		case errors.Is(err, engine.ErrGenerationInFlight):
			return e.Error(http.StatusConflict, "A generation for this projection is already running.", err)
		case errors.Is(err, engine.ErrContextTooLarge):
			return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
		case err != nil:
			logger(app).Error("generate failed", "target_type", "projection", "error", err)
			if usage.WriteProviderError(e, err) {
				return nil
			}
			if strings.Contains(err.Error(), "not found") {
				return e.NotFoundError("projection not found", err)
			}
			return e.InternalServerError("generate projection failed", err)
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
		if err := engine.ApproveSnapshot(e.Request.Context(), app, engine.ProjectionStrategy{}, snapID); err != nil {
			logger(app).Error("approve failed", "target_type", "projection", "error", err)
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
		res, err := engine.ApplyEdit(context.WithoutCancel(e.Request.Context()), app, engine.ProjectionStrategy{},
			e.Request.PathValue("id"), snapID, req.OldText, req.NewText)
		if err != nil {
			logger(app).Error("edit failed", "target_type", "projection", "error", err)
			switch {
			case errors.Is(err, engine.ErrEditNotPending):
				return e.Error(http.StatusConflict, err.Error(), err)
			case errors.Is(err, engine.ErrEditRejected):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
			return e.InternalServerError("edit failed", err)
		}
		return e.JSON(http.StatusOK, api.EditCandidateResponse{SnapshotID: res.SnapshotID, FragmentID: res.FragmentID})
	}
}
