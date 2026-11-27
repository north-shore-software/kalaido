package handlers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/refinement"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
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
				LensOutdated: st.HasApproved && st.GeneratedByModel != engine.SnapshotModelEmpty && st.LensID != currentLens,
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

// HandleGeneratePendingReflections synchronously generates every pending window
// across all live active reflections and returns the created snapshot IDs.
func HandleGeneratePendingReflections(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapIDs, err := reflections.GenerateAllPendingWindows(context.WithoutCancel(e.Request.Context()), app)
		if err != nil {
			logger().Error("generate pending reflections failed", "error", err)
			return e.InternalServerError("generate pending reflections failed", err)
		}
		if snapIDs == nil {
			snapIDs = []string{}
		}
		return e.JSON(http.StatusOK, api.ReflectionSnapshotResponse{SnapshotIDs: snapIDs})
	}
}

// HandleGetReflectionLens returns a reflection's current standing lens prompt.
func HandleGetReflectionLens(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		res, err := reflections.ReadLens(app, id)
		if err != nil {
			if errors.Is(err, reflections.ErrNotFound) {
				return e.NotFoundError("reflection not found", err)
			}
			return e.InternalServerError("read reflection lens failed", err)
		}
		return e.JSON(http.StatusOK, res)
	}
}

// HandleUpdateReflectionLens saves a revised standing lens prompt directly
// (appending a new lens row chained to the prior lens and updating current_lens_id).
func HandleUpdateReflectionLens(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		var req api.UpdateReflectionLensRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if strings.TrimSpace(req.Prompt) == "" {
			return e.BadRequestError("prompt required", nil)
		}
		res, err := reflections.UpdateLens(app, id, req.Prompt)
		if err != nil {
			if errors.Is(err, reflections.ErrNotFound) {
				return e.NotFoundError("reflection not found", err)
			}
			return e.InternalServerError("update reflection lens failed", err)
		}
		return e.JSON(http.StatusOK, res)
	}
}

// HandleEditReflectionWindow appends a new approved manual revision for a
// specific reflection window.
func HandleEditReflectionWindow(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		windowID := e.Request.PathValue("windowId")
		if id == "" || windowID == "" {
			return e.BadRequestError("reflection id and windowId required", nil)
		}
		var req api.EditReflectionWindowRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		snapID, err := reflections.EditWindowSnapshot(context.WithoutCancel(e.Request.Context()), app, id, windowID, req.Output)
		if err != nil {
			switch {
			case errors.Is(err, reflections.ErrEmptyOutput):
				return e.BadRequestError(err.Error(), err)
			case errors.Is(err, reflections.ErrNotFound):
				return e.NotFoundError("reflection not found", err)
			case errors.Is(err, reflections.ErrWindowNotFound):
				return e.NotFoundError("window not found", err)
			case errors.Is(err, reflections.ErrNoApprovedSnapshot):
				return e.Error(http.StatusConflict, err.Error(), err)
			default:
				logger().Error("edit reflection window failed", "id", id, "window_id", windowID, "error", err)
				return e.InternalServerError("edit reflection window failed", err)
			}
		}
		return e.JSON(http.StatusOK, api.EditReflectionWindowResponse{SnapshotID: snapID})
	}
}

func HandleGenerateReflectionSnapshot(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		var req api.GenerateReflectionSnapshotRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}

		st, err := reconcile.EvaluateEntity(e.Request.Context(), app, id)
		if err != nil {
			logger().Warn("staleness check failed", "target_type", "reflection", "error", err)
		}

		windowsToGenerate, err := reflections.WindowsToGenerate(app, rec, req, st)
		if err != nil {
			return e.BadRequestError(err.Error(), err)
		}

		genCtx := context.WithoutCancel(e.Request.Context())
		var snapIDs []string
		var firstErr error
		if len(windowsToGenerate) == 1 {
			snapID, err := reflections.GenerateWindowSnapshot(genCtx, app, id, windowsToGenerate[0])
			if err != nil {
				return WriteGenerateError(e, app, err, "reflection")
			}
			snapIDs = append(snapIDs, snapID)
		} else {
			plain := make([]api.Window, 0, len(windowsToGenerate))
			for _, w := range windowsToGenerate {
				plain = append(plain, *w)
			}
			for _, r := range reflections.GenerateWindows(genCtx, app, id, engine.StatusApproved, plain) {
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

// HandlePreviewReflectionWindows enumerates candidate sample windows and
// matching fragment counts for a staged schedule + context without mutating
// any reflection record or invoking an LLM.
func HandlePreviewReflectionWindows(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.PreviewReflectionWindowsRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		res, err := reflections.PreviewWindows(
			e.Request.Context(),
			app,
			req.ReflectionID,
			req.WindowSpec,
			req.ContextSpec,
			time.Now(),
		)
		if err != nil {
			if errors.Is(err, reflections.ErrInvalidWindowSpec) {
				return e.BadRequestError(err.Error(), err)
			}
			logger().Error("preview reflection windows failed", "error", err)
			return e.InternalServerError("preview reflection windows failed", err)
		}
		return e.JSON(http.StatusOK, res)
	}
}

// HandlePreviewReflection executes a staged standing lens strictly in isolation
// against one sample window's fragments (zero chat history, zero database
// mutations).
func HandlePreviewReflection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req api.PreviewReflectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		res, err := reflections.RunStagedPreview(e.Request.Context(), app, req)
		if err != nil {
			switch {
			case errors.Is(err, reflections.ErrEmptyLensPrompt), errors.Is(err, reflections.ErrInvalidPreviewWindow):
				return e.BadRequestError(err.Error(), err)
			default:
				return WriteGenerateError(e, app, err, "reflection")
			}
		}
		return e.JSON(http.StatusOK, res)
	}
}

// HandleSaveReflection atomically saves staged schedule, context sources,
// standing lens, and optional name in a single transaction, then kicks
// RunPendingWindows. Works with or without an open refinement chat session.
func HandleSaveReflection(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		var req api.SaveReflectionRequest
		if e.Request != nil && e.Request.Body != nil && e.Request.ContentLength != 0 {
			if err := e.BindBody(&req); err != nil && !errors.Is(err, io.EOF) {
				return e.BadRequestError("invalid request body", err)
			}
		}

		ctx := context.WithoutCancel(e.Request.Context())
		if req.RefinementID != "" {
			refRec, err := app.FindRecordById(schema.ColReflectionRefinement.String(), req.RefinementID)
			if err != nil {
				return e.NotFoundError("refinement not found", err)
			}
			lensID, err := refinement.CommitReflection(ctx, app, refRec, id, req, deps.Runner)
			if err != nil {
				return writeSaveReflectionError(e, err)
			}
			return e.JSON(http.StatusOK, api.SaveReflectionResponse{
				ID:     id,
				LensID: lensID,
			})
		}

		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		lensPrompt := ""
		if req.LensPrompt != nil && strings.TrimSpace(*req.LensPrompt) != "" {
			lensPrompt = strings.TrimSpace(*req.LensPrompt)
		} else {
			_, existingPrompt := engine.ReadActiveLens(app, reflections.Strategy{}, rec)
			lensPrompt = strings.TrimSpace(existingPrompt)
		}
		lensID, err := reflections.SaveTuning(app, id, reflections.SaveTuningParams{
			WindowSpec:  req.WindowSpec,
			ContextSpec: req.ContextSpec,
			LensPrompt:  lensPrompt,
			Name:        req.Name,
		})
		if err != nil {
			return writeSaveReflectionError(e, err)
		}
		if deps.Runner != nil {
			reflections.RunPendingWindows(deps.Runner, app, id)
		}
		return e.JSON(http.StatusOK, api.SaveReflectionResponse{
			ID:     id,
			LensID: lensID,
		})
	}
}

func writeSaveReflectionError(e *core.RequestEvent, err error) error {
	switch {
	case errors.Is(err, reflections.ErrNotFound):
		return e.NotFoundError("reflection not found", err)
	case errors.Is(err, reflections.ErrInvalidWindowSpec),
		errors.Is(err, reflections.ErrEmptyLensPrompt),
		errors.Is(err, refinement.ErrNoDraftedLens),
		errors.Is(err, refinement.ErrMissingParentID),
		errors.Is(err, refinement.ErrParentMismatch):
		return e.BadRequestError(err.Error(), nil)
	case errors.Is(err, refinement.ErrNoPreviewOutput):
		return e.Error(http.StatusConflict, err.Error(), nil)
	default:
		logger().Error("save reflection failed", "error", err)
		return e.InternalServerError("save reflection failed", err)
	}
}

// HandleDiscardReflectionDraft cleans up a never-saved reflection
// (current_lens_id == ""): hard-deletes user-created drafts or reverts
// Discover proposals to status="proposed". Refuses established reflections
// with 409 Conflict.
func HandleDiscardReflectionDraft(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}
		res, err := reflections.DiscardDraft(app, id)
		if err != nil {
			switch {
			case errors.Is(err, reflections.ErrNotFound):
				return e.NotFoundError("reflection not found", err)
			case errors.Is(err, reflections.ErrAlreadySaved):
				return e.Error(http.StatusConflict, err.Error(), nil)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "a generation is running for this reflection", nil)
			default:
				logger().Error("discard reflection draft failed", "id", id, "error", err)
				return e.InternalServerError("discard reflection draft failed", err)
			}
		}
		return e.JSON(http.StatusOK, api.DiscardReflectionDraftResponse{
			ID:                 id,
			DeletedReflection:  res.DeletedReflection,
			RevertedToProposed: res.RevertedToProposed,
		})
	}
}
