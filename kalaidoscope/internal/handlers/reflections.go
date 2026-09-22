// UNREVIEWED
package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// validateWindowSpec rejects a schedule the grid could not evaluate. An empty
// spec (unscheduled) is valid.
func validateWindowSpec(spec api.WindowSpec) error {
	if spec.Period == "" && spec.Duration == "" && spec.StartTime == "" {
		return nil
	}
	if p, err := time.ParseDuration(spec.Period); err != nil || p <= 0 {
		return errors.New("windowSpec.period must be a positive duration such as \"168h\"")
	}
	if spec.Duration != "" {
		if d, err := time.ParseDuration(spec.Duration); err != nil || d <= 0 {
			return errors.New("windowSpec.duration must be a positive duration such as \"168h\"")
		}
	}
	if spec.StartTime != "" {
		if _, err := time.Parse(time.RFC3339, spec.StartTime); err != nil {
			return errors.New("windowSpec.startTime must be RFC3339")
		}
	}
	return nil
}

// reflectionWindowsToGenerate picks the windows one generate call covers. An
// explicit windowId may name any materialized window (a re-run of history);
// otherwise the candidates are the windows owed (pending), those gone stale,
// and those whose snapshot predates the current lens — all of them with
// allWindows=true; and when nothing is owed, the current window — never a windowless
// snapshot for a scheduled reflection.
func reflectionWindowsToGenerate(e *core.RequestEvent, app core.App, rec *core.Record, req api.GenerateReflectionSnapshotRequest, st api.EntityStatus) ([]*api.Window, error) {
	if err := req.Validate(); err != nil {
		return nil, e.BadRequestError(err.Error(), err)
	}
	now := time.Now()
	series := reflections.SeriesWindows(app, rec, now)
	if req.WindowID != "" {
		for _, s := range series {
			if s.ID == req.WindowID {
				w := s.Window
				return []*api.Window{&w}, nil
			}
		}
		return nil, e.BadRequestError("window ID not found in this reflection's windows", nil)
	}
	seen := map[string]bool{}
	var candidates []api.Window
	add := func(w api.Window) {
		if !seen[w.ID] {
			seen[w.ID] = true
			candidates = append(candidates, w)
		}
	}
	currentLens := rec.GetString("current_lens_id")
	for _, s := range series {
		switch {
		case s.Generating:
		case !s.HasApproved:
			add(s.Window)
		case s.LensID != currentLens:
			add(s.Window)
		}
	}
	for _, w := range st.StaleWindows {
		add(w)
	}
	switch {
	case len(candidates) == 0:
		return []*api.Window{reflections.DefaultRefinementWindow(rec, now)}, nil
	case len(candidates) == 1 || req.AllWindows:
		ptrs := make([]*api.Window, len(candidates))
		for i := range candidates {
			ptrs[i] = &candidates[i]
		}
		return ptrs, nil
	default:
		return nil, e.BadRequestError("multiple windows are pending; pass allWindows=true to generate them all", nil)
	}
}

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
			logger(app).Error("reflection backfill failed", "reflection_id", id, "error", err)
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
		if st, err := entityStatus(e.Request.Context(), app, id); err == nil {
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
		if req.WindowSpec != nil {
			if err := validateWindowSpec(*req.WindowSpec); err != nil {
				return e.BadRequestError(err.Error(), err)
			}
		}

		var targetID string
		err := app.RunInTransaction(func(txApp core.App) error {
			col, err := txApp.FindCollectionByNameOrId(schema.ColReflection.String())
			if err != nil {
				return err
			}
			rec := core.NewRecord(col)
			rec.Set("name", req.Name)
			rec.Set("status", engine.EntityActive)
			if d := strings.TrimSpace(req.Description); d != "" {
				rec.Set("description", d)
			}
			spec := api.WindowSpec{}
			if req.WindowSpec != nil {
				spec = *req.WindowSpec
			}
			effective := time.Now()
			if st, err := time.Parse(time.RFC3339, spec.StartTime); err == nil && st.Before(effective) {
				effective = st
			}
			versions := reflections.AppendWindowSpecVersion(nil, spec, effective)
			rec.Set("window_spec_versions", pbutil.JSONObject(versions))

			if err := txApp.Save(rec); err != nil {
				return err
			}
			targetID = rec.Id
			return nil
		})
		if err != nil {
			logger(app).Error("create reflection failed", "error", err)
			return e.InternalServerError("create reflection failed", err)
		}

		logger(app).Info("created reflection", "id", targetID)
		return e.JSON(http.StatusCreated, api.CreateReflectionResponse{ReflectionID: targetID})
	}
}

func HandleUpdateReflection(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}

		var req api.UpdateReflectionRequest
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		if req.WindowSpec != nil {
			if err := validateWindowSpec(*req.WindowSpec); err != nil {
				return e.BadRequestError(err.Error(), err)
			}
		}

		if req.Name != nil {
			rec.Set("name", *req.Name)
		}
		if req.GenerateWithModel != nil {
			rec.Set("generate_with_model", *req.GenerateWithModel)
		}
		if req.WindowSpec != nil {
			spec := *req.WindowSpec
			versions := reflections.LoadWindowSpecVersions(rec)
			if spec.StartTime == "" {
				if cur, ok := reflections.GoverningVersion(versions, time.Now()); ok {
					spec.StartTime = cur.Spec.StartTime
				}
			}
			versions = reflections.AppendWindowSpecVersion(versions, spec, time.Now())
			rec.Set("window_spec_versions", pbutil.JSONObject(versions))
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
			logger(app).Error("update reflection failed", "error", err)
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

		rec, err := app.FindRecordById(schema.ColReflection.String(), id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		if engine.IsDeleted(rec) {
			return e.NoContent(http.StatusNoContent)
		}

		inFlight, err := engine.HasLiveClaim(app, reflections.Strategy{}, id)
		if err != nil {
			logger(app).Error("delete reflection failed", "id", id, "error", err)
			return e.InternalServerError("delete reflection failed", err)
		}
		if inFlight {
			return e.Error(http.StatusConflict, "a generation is running for this reflection", nil)
		}

		err = app.RunInTransaction(func(tx core.App) error {
			for _, collection := range []string{"projection", "reflection"} {
				if err := scrubIDFromSpecs(tx, collection, sourceReflectionIDs, id); err != nil {
					return err
				}
			}
			return engine.SoftDelete(tx, rec)
		})
		if err != nil {
			logger(app).Error("delete reflection failed", "id", id, "error", err)
			return e.InternalServerError("delete reflection failed", err)
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
		rec, err := app.FindRecordById(schema.ColReflection.String(), id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		if err := engine.Restore(app, rec); err != nil {
			logger(app).Error("restore reflection failed", "id", id, "error", err)
			return e.InternalServerError("restore reflection failed", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"id": id})
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

		status := engine.StatusApproved
		if req.Preview {
			status = engine.StatusPending
		}

		rec, err := reflections.FindLive(app, id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}

		st, err := entityStatus(e.Request.Context(), app, id)
		if err != nil {
			logger(app).Warn("staleness check failed", "target_type", "reflection", "error", err)
		} else if len(st.BlockedBy) > 0 {
			return e.Error(http.StatusConflict, "upstream dependencies are not up to date; approve them first", nil)
		}

		windowsToGenerate, err := reflectionWindowsToGenerate(e, app, rec, req, st)
		if err != nil {
			return err
		}

		genCtx := context.WithoutCancel(e.Request.Context())
		var snapIDs []string
		var firstErr error

		if len(windowsToGenerate) > 1 {
			plain := make([]api.Window, 0, len(windowsToGenerate))
			for _, w := range windowsToGenerate {
				plain = append(plain, *w)
			}
			for _, r := range reflections.GenerateWindows(genCtx, app, id, status, plain) {
				if r.Err != nil {
					if firstErr == nil {
						firstErr = r.Err
					}
					continue
				}
				snapIDs = append(snapIDs, r.SnapshotID)
			}
			windowsToGenerate = nil
		}
		for _, w := range windowsToGenerate {
			snapID, err := engine.GenerateSnapshot(genCtx, app, id, status, reflections.Strategy{}, w)
			if errors.Is(err, engine.ErrGenerationInFlight) {
				snapID, err = joinGeneration(e.Request.Context(), app, reflections.Strategy{}, id, w)
				if errors.Is(err, engine.ErrGenerationAbandoned) {
					snapID, err = engine.GenerateSnapshot(genCtx, app, id, status, reflections.Strategy{}, w)
				}
			}
			if err != nil {
				firstErr = err
			}
			switch {
			case errors.Is(err, usage.ErrExhausted):
				return usage.WriteExhausted(e, app)
			case errors.Is(err, engine.ErrLensNotReady):
				return e.Error(http.StatusConflict, "This reflection's lens is still being prepared — try again in a moment.", err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "A generation for this reflection is already running.", err)
			case errors.Is(err, llm.ErrContextTooLarge):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			case err != nil:
				logger(app).Error("generate failed", "target_type", "reflection", "error", err)
				if usage.WriteProviderError(e, err) {
					return nil
				}
				if strings.Contains(err.Error(), "not found") {
					return e.NotFoundError("reflection not found", err)
				}
				return e.InternalServerError("generate reflection failed", err)
			}
			if snapID != "" {
				snapIDs = append(snapIDs, snapID)
			}
		}

		if firstErr != nil && len(snapIDs) == 0 {
			err := firstErr
			switch {
			case errors.Is(err, usage.ErrExhausted):
				return usage.WriteExhausted(e, app)
			case errors.Is(err, engine.ErrLensNotReady):
				return e.Error(http.StatusConflict, "This reflection's lens is still being prepared — try again in a moment.", err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict, "A generation for this reflection is already running.", err)
			case errors.Is(err, llm.ErrContextTooLarge):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			default:
				logger(app).Error("generate failed", "target_type", "reflection", "error", err)
				if usage.WriteProviderError(e, err) {
					return nil
				}
				return e.InternalServerError("generate reflection failed", err)
			}
		} else if firstErr != nil {
			logger(app).Warn("generate: some windows failed", "target_type", "reflection", "succeeded", len(snapIDs), "error", firstErr)
		}

		return e.JSON(http.StatusOK, api.ReflectionSnapshotResponse{SnapshotIDs: snapIDs})
	}
}
