package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

// HandleBackfillReflection materializes the grid windows between `from` and
// the point the schedule already covers, then generates them in the
// background. Progress arrives as reflection_snapshot rows over the live
// subscription; the response only says which windows were materialized.
func HandleBackfillReflection(app core.App, runner workerutil.Runner) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("reflection id required", nil)
		}
		var req api.BackfillRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		from, err := time.Parse(time.RFC3339, req.From)
		if err != nil {
			return e.BadRequestError("from must be RFC3339", err)
		}
		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		windows, err := reflections.MaterializeBackfill(app, rec, from, time.Now())
		switch {
		case errors.Is(err, reflections.ErrBackfillOutOfRange):
			return e.BadRequestError(err.Error(), err)
		case err != nil:
			logger().Error("reflection backfill failed", "reflection_id", id, "error", err)
			return e.InternalServerError("backfill failed", err)
		}
		reflections.RunPendingWindows(runner, app, id)
		return e.JSON(http.StatusOK, api.BackfillResponse{Windows: windows})
	}
}

// HandleListReflectionWindows serves a reflection's series: every
// materialized window, oldest first, with whether it has an approved
// snapshot or a generation in flight. The refine panel's window selector and
// the backfill affordance read from it.
func HandleListReflectionWindows(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("reflection id required", nil)
		}
		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		stale := map[string]bool{}
		if st, err := reconcile.EvaluateEntity(e.Request.Context(), app, id); err == nil {
			for _, w := range st.StaleWindows {
				stale[w.ID] = true
			}
		}
		series := reflections.SeriesWindows(app, rec, time.Now())
		currentLens := rec.GetString("current_lens_id")
		res := api.ReflectionWindowsResponse{Windows: make([]api.WindowInfo, 0, len(series))}
		for _, st := range series {
			res.Windows = append(res.Windows, api.WindowInfo{
				Window:       st.Window,
				Key:          st.Key,
				HasApproved:  st.HasApproved,
				Generating:   st.Generating,
				Backfilled:   st.Backfilled,
				Stale:        stale[st.ID],
				LensOutdated: st.HasApproved && st.LensID != currentLens,
			})
		}
		if win := reflections.DefaultRefinementWindow(rec, time.Now()); win != nil {
			res.CurrentWindowID = win.ID
		}
		return e.JSON(http.StatusOK, res)
	}
}

func HandleCreateReflection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.CreateReflectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		target, err := reflections.Create(app, reflections.CreateParams{
			Name:        req.Name,
			Description: req.Description,
			WindowSpec:  req.WindowSpec,
		})
		if err != nil {
			if errors.Is(err, reflections.ErrInvalidWindowSpec) {
				return e.BadRequestError(err.Error(), err)
			}
			logger().Error("create reflection failed", "error", err)
			return e.InternalServerError("create reflection failed", err)
		}

		logger().Info("created reflection", "id", target.Id)
		return e.JSON(http.StatusCreated, api.CreateReflectionResponse{ReflectionID: target.Id})
	}
}

func HandleUpdateReflection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		var req api.UpdateReflectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		authID := ""
		if e.Auth != nil {
			authID = e.Auth.Id
		}

		_, err := reflections.Update(app, id, reflections.UpdateParams{
			Name:              req.Name,
			GenerateWithModel: req.GenerateWithModel,
			WindowSpec:        req.WindowSpec,
			Pinned:            req.Pinned,
			AuthID:            authID,
		})
		if err != nil {
			if errors.Is(err, reflections.ErrNotFound) {
				return e.NotFoundError("reflection not found", err)
			}
			if errors.Is(err, reflections.ErrInvalidWindowSpec) {
				return e.BadRequestError(err.Error(), err)
			}
			logger().Error("update reflection failed", "error", err)
			return e.InternalServerError("update reflection failed", err)
		}

		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

func HandleDeleteReflection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		err := reflections.Delete(app, id)
		if err != nil {
			switch {
			case errors.Is(err, reflections.ErrNotFound):
				return e.NotFoundError("reflection not found", err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "a generation is running for this reflection", nil)
			default:
				logger().Error("delete reflection failed", "id", id, "error", err)
				return e.InternalServerError("delete reflection failed", err)
			}
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func HandleRestoreReflection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		_, err := reflections.Restore(app, id)
		if err != nil {
			if errors.Is(err, reflections.ErrNotFound) {
				return e.NotFoundError("reflection not found", err)
			}
			logger().Error("restore reflection failed", "id", id, "error", err)
			return e.InternalServerError("restore reflection failed", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

func HandleGenerateReflectionSnapshot(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		var req api.GenerateReflectionSnapshotRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		status := engine.StatusApproved
		if req.Preview {
			status = engine.StatusPending
		}

		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}

		st, err := reconcile.EvaluateEntity(e.Request.Context(), app, id)
		if err != nil {
			logger().Warn("staleness check failed", "target_type", "reflection", "error", err)
		} else if len(st.BlockedBy) > 0 {
			return e.Error(http.StatusConflict, "upstream dependencies are not up to date; approve them first", nil)
		}

		windowsToGenerate, err := reflections.WindowsToGenerate(app, rec, req, st)
		if err != nil {
			return e.BadRequestError(err.Error(), err)
		}

		// The generation outlives the request; only waiting on another run
		// is bounded by it.
		genCtx := context.WithoutCancel(e.Request.Context())
		var snapIDs []string
		var firstErr error
		if len(windowsToGenerate) == 1 {
			snapID, err := deps.GenerateReflectionSnapshot(genCtx, e.Request.Context(), id, status, windowsToGenerate[0])
			if err != nil {
				return WriteGenerateError(e, app, err, "reflection")
			}
			snapIDs = append(snapIDs, snapID)
		} else {
			plain := make([]api.Window, 0, len(windowsToGenerate))
			for _, w := range windowsToGenerate {
				plain = append(plain, *w)
			}
			for _, r := range deps.GenerateReflectionWindows(genCtx, id, status, plain) {
				if r.Err != nil {
					if firstErr == nil {
						firstErr = r.Err
					}
					continue
				}
				snapIDs = append(snapIDs, r.SnapshotID)
			}
		}

		// Windows fail independently: the response carries whichever
		// generated, and only a total failure is an error.
		if firstErr != nil && len(snapIDs) == 0 {
			return WriteGenerateError(e, app, firstErr, "reflection")
		}
		if firstErr != nil {
			logger().Warn("generate: some windows failed", "target_type", "reflection", "succeeded", len(snapIDs), "error", firstErr)
		}

		return e.JSON(http.StatusOK, api.ReflectionSnapshotResponse{SnapshotIDs: snapIDs})
	}
}
