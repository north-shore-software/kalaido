package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
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
	snap, err := app.FindRecordById(strat.SnapshotCollectionName(), snapID)
	if err != nil {
		return "", e.NotFoundError("candidate not found", err)
	}
	if snap.GetString(strat.ForeignKeyCol()) != id {
		return "", e.NotFoundError("candidate does not belong to this "+strat.TargetType(), nil)
	}
	return snapID, nil
}

// entityStatus is `id`'s row of the same evaluation `GET /api/rotation`
// serves; a zero status when the entity is not evaluated (a draft).
func entityStatus(ctx context.Context, app core.App, id string) (api.EntityStatus, error) {
	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(ctx)
	if err != nil {
		return api.EntityStatus{}, err
	}
	for _, s := range statuses {
		if s.ID == id {
			return s, nil
		}
	}
	return api.EntityStatus{}, nil
}

// reflectionWindowsToGenerate picks the windows one generate call covers. An
// explicit windowId may name any materialized window (a re-run of history);
// otherwise the candidates are the windows owed (pending) plus those gone
// stale, all of them with all=true; and when nothing is owed, the current
// window — never a windowless snapshot for a scheduled reflection.
func reflectionWindowsToGenerate(e *core.RequestEvent, app core.App, rec *core.Record, req api.GenerateSnapshotRequest, st api.EntityStatus) ([]*api.Window, error) {
	now := time.Now()
	if req.WindowID != "" {
		for _, s := range engine.SeriesWindows(app, rec, now) {
			if s.ID == req.WindowID {
				w := s.Window
				return []*api.Window{&w}, nil
			}
		}
		return nil, e.BadRequestError("window ID not found in this reflection's windows", nil)
	}
	candidates := append(append([]api.Window(nil), st.PendingWindows...), st.StaleWindows...)
	if len(candidates) == 0 {
		// A draft (no approved snapshot) is not evaluated; ask the engine
		// directly so a first Refresh still catches up.
		candidates = engine.PendingWindows(app, rec, now)
	}
	switch {
	case len(candidates) == 0:
		return []*api.Window{engine.DefaultRefinementWindow(rec, now)}, nil
	case len(candidates) == 1 || req.All:
		out := make([]*api.Window, 0, len(candidates))
		for i := range candidates {
			out = append(out, &candidates[i])
		}
		return out, nil
	default:
		return nil, e.BadRequestError("multiple pending windows; specify windowId or all=true", nil)
	}
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

		// A candidate generated while an upstream is still awaiting approval is
		// stale the moment that upstream lands: its resolved context is frozen
		// at generation time, so approving it would not settle anything. Refuse
		// rather than burn a model call on output that cannot clear the entity.
		st, err := entityStatus(e.Request.Context(), app, id)
		if err != nil {
			// Never let the freshness check itself stop a requested generation.
			log.Printf("%s.generate: staleness check: %v", strat.TargetType(), err)
		} else if len(st.BlockedBy) > 0 {
			return e.Error(http.StatusConflict,
				"upstream dependencies are not up to date; approve them first", nil)
		}

		windowsToGenerate := []*api.Window{nil}
		if strat.TargetType() == "reflection" {
			windowsToGenerate, err = reflectionWindowsToGenerate(e, app, rec, req, st)
			if err != nil {
				return err
			}
		}

		// Detached from the request context: once a generation starts it runs
		// to completion — a client that navigates away or re-triggers must
		// never truncate the stream mid-document. The result lands in the DB
		// and reaches the UI over the live subscription even if this response
		// is never read.
		genCtx := context.WithoutCancel(e.Request.Context())

		var snapIDs []string
		for _, w := range windowsToGenerate {
			snapID, err := engine.GenerateSnapshot(genCtx, app, id, status, strat, w)
			switch {
			case errors.Is(err, usage.ErrExhausted):
				return usage.WriteExhausted(e, app)
			case errors.Is(err, engine.ErrLensNotReady):
				return e.Error(http.StatusConflict,
					"This "+strat.TargetType()+"'s lens is still being prepared — try again in a moment.", err)
			case errors.Is(err, engine.ErrGenerationInFlight):
				return e.Error(http.StatusConflict,
					"A generation for this "+strat.TargetType()+" is already running.", err)
			case errors.Is(err, engine.ErrContextTooLarge):
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			case err != nil:
				log.Printf("%s.generate: %v", strat.TargetType(), err)
				if usage.WriteProviderError(e, err) {
					return nil
				}
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
			if errors.Is(err, engine.ErrNotApprovable) {
				return e.Error(http.StatusUnprocessableEntity, err.Error(), err)
			}
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
			// Reflections only: the schedule. A Start Time in the past is
			// "summarize from then": the first version is effective from it,
			// so every grid window since is pending (the backfill).
			WindowSpec *api.WindowSpec `json:"windowSpec,omitempty"`
		}
		var req reqBody
		if err := e.BindBody(&req); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if req.WindowSpec != nil {
			if strat.TargetType() != "reflection" {
				return e.BadRequestError("windowSpec is only valid for reflections", nil)
			}
			if err := validateWindowSpec(*req.WindowSpec); err != nil {
				return e.BadRequestError(err.Error(), err)
			}
		}

		var targetID string
		err := app.RunInTransaction(func(txApp core.App) error {
			col, err := txApp.FindCollectionByNameOrId(strat.CollectionName())
			if err != nil {
				return err
			}
			rec := core.NewRecord(col)
			rec.Set("name", req.Name)
			rec.Set("status", engine.EntityActive)
			if strat.TargetType() == "reflection" {
				spec := api.WindowSpec{}
				if req.WindowSpec != nil {
					spec = *req.WindowSpec
				}
				effective := time.Now()
				if st, err := time.Parse(time.RFC3339, spec.StartTime); err == nil && st.Before(effective) {
					effective = st
				}
				versions := engine.AppendWindowSpecVersion(nil, spec, effective)
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
			// Per-entity model override; "" clears back to the workspace default.
			Model *string `json:"model,omitempty"`
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

		if req.Model != nil {
			rec.Set("model", strings.TrimSpace(*req.Model))
		}

		if req.WindowSpec != nil {
			if strat.TargetType() != "reflection" {
				return e.BadRequestError("windowSpec is only valid for reflections", nil)
			}
			if err := validateWindowSpec(*req.WindowSpec); err != nil {
				return e.BadRequestError(err.Error(), err)
			}
			spec := *req.WindowSpec
			versions := engine.LoadWindowSpecVersions(rec)
			// The grid origin is part of the reflection's identity: an edit
			// that only changes cadence or lookback keeps it, so windows stay
			// phase-aligned with the ones already generated.
			if spec.StartTime == "" {
				if cur, ok := engine.GoverningVersion(versions, time.Now()); ok {
					spec.StartTime = cur.Spec.StartTime
				}
			}
			versions = engine.AppendWindowSpecVersion(versions, spec, time.Now())
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
