package handlers

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// HandleReconcile starts a speculative "generate all" wave over the stale set
// and returns immediately. There is no run state to report: candidates land
// through the ordinary realtime channel, and queue activity is already
// visible via llm_queue_status.
func HandleReconcile(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		reconcile.EnqueueWave()
		return e.NoContent(http.StatusAccepted)
	}
}
