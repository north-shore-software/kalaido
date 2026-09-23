package handlers

import (
	"log/slog"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

func logger() *slog.Logger {
	return slog.Default().With("component", "handlers")
}

// Deps are the long-lived components a handler reaches beyond the database:
// the background workers it wakes or reads, and the runner that owns any
// work it starts off the request goroutine. The server builds one set and
// hands it to every route that needs it. Both fields are required: handlers
// reach the workers through Manager without checking for nil (tests build
// one with testDeps).
type Deps struct {
	*workers.Manager
	Runner workerutil.Runner
}

func (d Deps) statusWorkers() status.Workers {
	if d.Manager == nil {
		return status.Workers{}
	}
	return status.Workers{Colour: d.Colour, Mapping: d.Mapping, Reconcile: d.Reconcile, Discover: d.Discover}
}
