// UNREVIEWED
package handlers

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workers"
)

// testDeps builds a handler's dependencies over app with every worker
// constructed but never run: a signal is recorded on its channel and goes
// no further. Handler tests exercise the request path only; the runner
// discards background work that would otherwise outlive the test's app.
func testDeps(app core.App) Deps {
	return Deps{
		Manager: workers.New(app, workers.Options{}),
		Runner:  engine.DiscardRunner{},
	}
}
