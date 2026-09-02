package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
)

// HandleBackfillReflection materializes the grid windows between `from` and
// the point the schedule already covers, then generates them in the
// background. Progress arrives as reflection_snapshot rows over the live
// subscription; the response only says which windows were materialized.
func HandleBackfillReflection(app core.App) func(e *core.RequestEvent) error {
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
		rec, err := app.FindRecordById("reflection", id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		windows, err := engine.MaterializeBackfill(app, rec, from, time.Now())
		switch {
		case errors.Is(err, engine.ErrBackfillOutOfRange):
			return e.BadRequestError(err.Error(), err)
		case err != nil:
			log.Printf("reflection.backfill %s: %v", id, err)
			return e.InternalServerError("backfill failed", err)
		}
		engine.RunPendingWindows(app, id)
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
		rec, err := app.FindRecordById("reflection", id)
		if err != nil {
			return e.NotFoundError("reflection not found", err)
		}
		stale := map[string]bool{}
		if st, err := entityStatus(e.Request.Context(), app, id); err == nil {
			for _, w := range st.StaleWindows {
				stale[w.ID] = true
			}
		}
		series := engine.SeriesWindows(app, rec, time.Now())
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
		if win := engine.DefaultRefinementWindow(rec, time.Now()); win != nil {
			res.CurrentWindowID = win.ID
		}
		return e.JSON(http.StatusOK, res)
	}
}

func HandleCreateReflection(app core.App) func(e *core.RequestEvent) error {
	return handleCreate(app, engine.ReflectionStrategy{})
}

func HandleGenerateReflectionSnapshot(app core.App) func(e *core.RequestEvent) error {
	return handleGenerateSnapshot(app, engine.ReflectionStrategy{})
}

func HandleUpdateReflection(app core.App) func(e *core.RequestEvent) error {
	return handleUpdate(app, engine.ReflectionStrategy{})
}

func HandleDeleteReflection(app core.App) func(e *core.RequestEvent) error {
	return handleDelete(app, engine.ReflectionStrategy{})
}
