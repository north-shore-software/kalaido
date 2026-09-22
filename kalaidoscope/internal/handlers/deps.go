// UNREVIEWED
package handlers

import (
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "handlers")
	}
	return slog.Default().With("component", "handlers")
}

// Deps are the long-lived components a handler reaches beyond the database:
// the background workers it wakes or reads, and the runner that owns any
// work it starts off the request goroutine. The server builds one set and
// hands it to every route that needs it.
type Deps struct {
	*workers.Manager
	Runner workerutil.Runner
}

func (d Deps) statusWorkers() status.Workers {
	return status.Workers{Mapping: d.Mapping, Reconcile: d.Reconcile, Discover: d.Discover}
}

// entityStatus is kept as an alias for tests in the handlers package.
var entityStatus = reconcile.EvaluateEntity
