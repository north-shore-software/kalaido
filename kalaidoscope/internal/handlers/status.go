package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/internal/api"
	"github.com/north-shore-software/kalaido/internal/status"
)

func HandleGetRotation(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		evaluator := status.NewEvaluator(app, time.Now())

		statuses, err := evaluator.EvaluateAll(e.Request.Context())
		if err != nil {
			log.Printf("rotation.status: evaluation failed: %v", err)
			return e.InternalServerError("failed to evaluate staleness", err)
		}

		return e.JSON(http.StatusOK, api.StatusResponse{
			Statuses: statuses,
		})
	}
}
