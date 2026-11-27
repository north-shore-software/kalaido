package handlers

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// HandleGetReconcile serves entity staleness under GET /api/reconcile.
func HandleGetReconcile(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		evaluator := reconcile.NewEvaluator(app, time.Now())
		statuses, err := evaluator.EvaluateAll(e.Request.Context())
		if err != nil {
			logger().Error("reconcile evaluation failed", "error", err)
			return e.InternalServerError("failed to evaluate staleness", err)
		}

		return e.JSON(http.StatusOK, api.ReconcilePlanResponse{
			Statuses: statuses,
		})
	}
}
