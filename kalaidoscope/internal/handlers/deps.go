// UNREVIEWED
package handlers

import (
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/organize"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// Deps are the long-lived components a handler reaches beyond the database:
// the background workers it wakes or reads, and the runner that owns any
// work it starts off the request goroutine. The server builds one set and
// hands it to every route that needs it.
type Deps struct {
	Colour    *colour.Worker
	Mapping   *mapping.Worker
	Reconcile *reconcile.Worker
	Discover  *discover.Worker
	Runner    engine.Runner
}

func (d Deps) organizeWorkers() organize.Workers {
	return organize.Workers{Mapping: d.Mapping, Reconcile: d.Reconcile, Discover: d.Discover}
}
