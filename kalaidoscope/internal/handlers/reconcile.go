package handlers

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// HandleGetReconcile serves entity staleness and in-flight wave state under GET /api/reconcile.
func HandleGetReconcile(app core.App, waves *reconcile.Worker) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		evaluator := reconcile.NewEvaluator(app, time.Now())
		statuses, err := evaluator.EvaluateAll(e.Request.Context())
		if err != nil {
			logger(app).Error("reconcile evaluation failed", "error", err)
			return e.InternalServerError("failed to evaluate staleness", err)
		}

		var st api.ReconcileStatus
		if waves != nil {
			st = waves.EvaluateStatus()
		}

		return e.JSON(http.StatusOK, api.ReconcilePlanResponse{
			ReconcileStatus: st,
			Statuses:        statuses,
		})
	}
}

// HandleReconcile is the reconcile ritual's Start: it begins a speculative
// wave over the stale set and returns immediately. Candidates land through
// the ordinary realtime channel, and the wave's state (running, last error,
// last completion) is reported by GET /api/organize.
func HandleReconcile(waves *reconcile.Worker) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if waves != nil {
			waves.StartWave()
		}
		return e.NoContent(http.StatusAccepted)
	}
}
