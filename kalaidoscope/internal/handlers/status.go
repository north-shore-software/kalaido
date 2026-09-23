package handlers

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
)

// HandleGetStatus evaluates and returns the full Kaleidoscope system status under GET /api/status.
func HandleGetStatus(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		st, err := status.Evaluate(e.Request.Context(), app, time.Now(), deps.statusWorkers())
		if err != nil {
			logger().Error("status evaluation failed", "error", err)
			return e.InternalServerError("failed to evaluate status", err)
		}
		return e.JSON(http.StatusOK, st)
	}
}
