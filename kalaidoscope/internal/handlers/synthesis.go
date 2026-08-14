package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

func resolveCandidate(e *core.RequestEvent, app core.App, strat engine.Strategy) (string, error) {
	id := e.Request.PathValue("id")
	if id == "" {
		return "", e.BadRequestError(strat.TargetType()+" id required", nil)
	}
	snapID := e.Request.PathValue("rid")
	if snapID == "" {
		return "", e.BadRequestError("candidate id required", nil)
	}
	return snapID, nil
}

func handleGenerateSnapshot(app core.App, strat engine.Strategy) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError(strat.TargetType()+" id required", nil)
		}

		var req api.GenerateSnapshotRequest
		_ = e.BindBody(&req) // defaults to empty

		status := engine.StatusPending
		if !req.Preview {
			status = engine.StatusApproved
		} else {
			status = engine.StatusPending
		}

		rec, err := app.FindRecordById(strat.CollectionName(), id)
		if err != nil {
			return e.NotFoundError(strat.TargetType()+" not found", err)
		}

		var windowsToGenerate []*api.Window
		pending, err := strat.GetPendingWindows(app, rec)
		if err != nil {
			return e.InternalServerError("failed to get pending windows", err)
		}

		if len(pending) > 0 {
			if req.WindowID != "" {
				var found bool
				for _, w := range pending {
					if w.ID == req.WindowID {
						winCopy := w
						windowsToGenerate = append(windowsToGenerate, &winCopy)
						found = true
						break
					}
				}
				if !found {
					return e.BadRequestError("window ID not found in pending windows", nil)
				}
			} else if req.All {
				for _, w := range pending {
					winCopy := w
					windowsToGenerate = append(windowsToGenerate, &winCopy)
				}
			} else {
				if len(pending) == 1 {
					winCopy := pending[0]
					windowsToGenerate = append(windowsToGenerate, &winCopy)
				} else {
					return e.BadRequestError("multiple pending windows; specify windowId or all=true", nil)
				}
			}
		} else {

			windowsToGenerate = append(windowsToGenerate, nil)
		}

		var snapIDs []string
		for _, w := range windowsToGenerate {
			snapID, err := engine.GenerateSnapshot(e.Request.Context(), app, id, status, strat, w)
			switch {
			case errors.Is(err, usage.ErrExhausted):
				return usage.WriteExhausted(e, app)
			case err != nil:
				log.Printf("%s.generate: %v", strat.TargetType(), err)
				if strings.Contains(err.Error(), "not found") {
					return e.NotFoundError(strat.TargetType()+" not found", err)
				}
				return e.InternalServerError("generate "+strat.TargetType()+" failed", err)
			}
			if snapID != "" {
				snapIDs = append(snapIDs, snapID)
			}
		}

		if strat.TargetType() == "projection" {
			var singleID string
			if len(snapIDs) > 0 {
				singleID = snapIDs[0]
			}
			return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{SnapshotID: singleID})
		}
		return e.JSON(http.StatusOK, api.ReflectionSnapshotResponse{SnapshotIDs: snapIDs})
	}
}

func handleApproveCandidate(app core.App, strat engine.Strategy) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		snapID, herr := resolveCandidate(e, app, strat)
		if herr != nil {
			return herr
		}
		if err := engine.ApproveSnapshot(e.Request.Context(), app, strat, snapID); err != nil {
			log.Printf("%s.approve: %v", strat.TargetType(), err)
			return e.InternalServerError("approve failed", err)
		}
		if strat.TargetType() == "projection" {
			return e.JSON(http.StatusOK, api.ProjectionSnapshotResponse{SnapshotID: snapID})
		}
		return e.JSON(http.StatusOK, api.ReflectionSnapshotResponse{SnapshotIDs: []string{snapID}})
	}
}

func handleCreate(app core.App, strat engine.Strategy) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		type reqBody struct {
			Name string `json:"name"`
		}
		var req reqBody
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		var targetID string
		err := app.RunInTransaction(func(txApp core.App) error {
			col, err := txApp.FindCollectionByNameOrId(strat.CollectionName())
			if err != nil {
				return err
			}
			rec := core.NewRecord(col)
			rec.Set("name", req.Name)
			if strat.TargetType() == "reflection" {
				versions := engine.AppendWindowSpecVersion(nil, api.WindowSpec{}, time.Now())
				rec.Set("window_spec_versions", pbutil.JSONObject(versions))
			}
			if err := txApp.Save(rec); err != nil {
				return err
			}
			targetID = rec.Id
			return nil
		})
		if err != nil {
			log.Printf("%s.create: %v", strat.TargetType(), err)
			return e.InternalServerError("create "+strat.TargetType()+" failed", err)
		}

		log.Printf("%s.create: ok %s=%s", strat.TargetType(), strat.TargetType(), targetID)
		if strat.TargetType() == "projection" {
			return e.JSON(http.StatusCreated, api.CreateProjectionResponse{
				ProjectionID: targetID,
			})
		}
		return e.JSON(http.StatusCreated, api.CreateReflectionResponse{
			ReflectionID: targetID,
		})
	}
}

func handleUpdate(app core.App, strat engine.Strategy) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		type reqBody struct {
			Name       *string         `json:"name,omitempty"`
			Pinned     *bool           `json:"pinned,omitempty"`
			WindowSpec *api.WindowSpec `json:"windowSpec,omitempty"`
		}
		var req reqBody
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}

		rec, err := app.FindRecordById(strat.CollectionName(), id)
		if err != nil {
			return e.NotFoundError(strat.TargetType()+" not found", err)
		}

		if req.Name != nil {
			rec.Set("name", *req.Name)
		}

		if req.WindowSpec != nil {
			if strat.TargetType() != "reflection" {
				return e.BadRequestError("windowSpec is only valid for reflections", nil)
			}
			versions := engine.AppendWindowSpecVersion(
				engine.LoadWindowSpecVersions(rec), *req.WindowSpec, time.Now())
			rec.Set("window_spec_versions", pbutil.JSONObject(versions))
		}

		if req.Pinned != nil {
			if e.Auth != nil {
				pinnedBy := rec.GetStringSlice("pinned_by")
				var newPinnedBy []string
				if *req.Pinned {

					found := false
					for _, uid := range pinnedBy {
						if uid == e.Auth.Id {
							found = true
						}
						newPinnedBy = append(newPinnedBy, uid)
					}
					if !found {
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
		}

		if err := app.Save(rec); err != nil {
			log.Printf("%s.update: %v", strat.TargetType(), err)
			return e.InternalServerError("update "+strat.TargetType()+" failed", err)
		}

		return e.JSON(http.StatusOK, map[string]string{"id": id})
	}
}

func handleDelete(app core.App, strat engine.Strategy) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if id == "" {
			return e.BadRequestError("id required", nil)
		}

		rec, err := app.FindRecordById(strat.CollectionName(), id)
		if err != nil {
			return e.NotFoundError(strat.TargetType()+" not found", err)
		}

		if err := app.Delete(rec); err != nil {
			log.Printf("%s.delete: %v", strat.TargetType(), err)
			return e.InternalServerError("delete "+strat.TargetType()+" failed", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}
