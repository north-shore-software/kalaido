package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

// HandleGetUsage reports this month's token usage split into prompt, cached
// and completion tokens. The usage collection itself is superuser-only, so
// this is how the settings page reads it; the cloud's /api/quota adds the
// allowance balance on top.
func HandleGetUsage(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, usage.CurrentPeriod(app))
	}
}
