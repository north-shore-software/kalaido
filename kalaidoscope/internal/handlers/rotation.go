package handlers

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// HandleGetRotation evaluates and returns entity staleness and DAG dependency order under GET /api/rotation.
func HandleGetRotation(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		evaluator := reconcile.NewEvaluator(app, time.Now())

		statuses, err := evaluator.EvaluateAll(e.Request.Context())
		if err != nil {
			logger(app).Error("rotation status evaluation failed", "error", err)
			return e.InternalServerError("failed to evaluate staleness", err)
		}

		return e.JSON(http.StatusOK, api.StatusResponse{
			Statuses: statuses,
		})
	}
}
