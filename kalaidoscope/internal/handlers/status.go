package handlers

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
)

func HandleGetRotation(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		evaluator := status.NewEvaluator(app, time.Now())

		statuses, err := evaluator.EvaluateAll(e.Request.Context())
		if err != nil {
			logger().Error("rotation status evaluation failed", "error", err)
			return e.InternalServerError("failed to evaluate staleness", err)
		}

		return e.JSON(http.StatusOK, api.StatusResponse{
			Statuses: statuses,
		})
	}
}
