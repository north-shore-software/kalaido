package handlers

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

// testDeps builds a handler's dependencies over app with every worker
// constructed but never run: a signal is recorded on its channel and goes
// no further. Handler tests exercise the request path only; the runner
// discards background work that would otherwise outlive the test's app.
func testDeps(app core.App) Deps {
	maps := mapping.NewWorker(app)
	return Deps{
		Colour:    colour.NewWorker(app),
		Mapping:   maps,
		Reconcile: reconcile.NewWorker(app, reconcile.Options{}),
		Discover:  discover.NewWorker(app, maps),
		Runner:    engine.DiscardRunner{},
	}
}
