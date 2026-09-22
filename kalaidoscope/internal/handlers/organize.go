// UNREVIEWED
package handlers

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/organize"
)

func HandleGetOrganize(app core.App, deps Deps) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		st, err := organize.Evaluate(e.Request.Context(), app, time.Now(), deps.organizeWorkers())
		if err != nil {
			logger(app).Error("organize status evaluation failed", "error", err)
			return e.InternalServerError("failed to evaluate organize status", err)
		}
		return e.JSON(http.StatusOK, st)
	}
}
