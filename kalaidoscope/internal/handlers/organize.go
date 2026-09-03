package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/organize"
)

func HandleGetOrganize(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		st, err := organize.Evaluate(e.Request.Context(), app, time.Now())
		if err != nil {
			log.Printf("organize.status: evaluation failed: %v", err)
			return e.InternalServerError("failed to evaluate organize status", err)
		}
		return e.JSON(http.StatusOK, st)
	}
}
