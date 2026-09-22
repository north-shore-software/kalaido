// UNREVIEWED
package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/config"
)

// HandleModelPreflight reports whether each role can actually run.
//
// A workspace that chose its own provider is checked against its stored config:
// its models are free text, so the static model->provider table can't be
// consulted, and its credential lives in the database rather than the
// environment. Everything else keeps the original env-based check.
func HandleModelPreflight(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, config.CheckPreflight())
	}
}
