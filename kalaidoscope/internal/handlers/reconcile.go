package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// HandleReconcile is the reconcile ritual's Start: it begins a speculative
// wave over the stale set and returns immediately. Candidates land through
// the ordinary realtime channel, and the wave's state (running, last error,
// last completion) is reported by GET /api/organize.
func HandleReconcile(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		reconcile.StartWave()
		return e.NoContent(http.StatusAccepted)
	}
}
