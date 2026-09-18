package mapping

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	consolidatePendingFloor = 50
	consolidateStaleAge     = time.Minute
	aggregateTick           = 10 * time.Second
)

var aggregateMu sync.Mutex

var consolidating atomic.Bool

func Consolidating() bool { return consolidating.Load() }

// settleHooks run after every cycle, outside the aggregate lock, so readers
// that derive from the map (colour membership) follow it without the map
// package knowing them.
var settleHooks []func(core.App)

// OnSettle registers a hook to run after each map cycle.
func OnSettle(fn func(core.App)) {
	settleHooks = append(settleHooks, fn)
}

func aggregateLoop() {
	for range time.Tick(aggregateTick) {
		due, err := consolidateDue(workerApp, time.Now())
		if err != nil {
			logger().Error("consolidate check failed", "error", err)
			continue
		}
		if due {
			cycle(workerApp)
		}
	}
}

func consolidateDue(app core.App, now time.Time) (bool, error) {
	rows, err := app.FindRecordsByFilter("fragment_annotation", "consolidated_at = ''", "-created", 0, 0, nil)
	if err != nil || len(rows) == 0 {
		return false, err
	}
	if len(rows) > consolidatePendingFloor {
		return true, nil
	}
	newest := rows[0].GetDateTime("created").Time()
	return now.Sub(newest) > consolidateStaleAge, nil
}

func settle(app core.App) {
	cycle(app)
}

func cycle(app core.App) {
	integrate(app)
	for _, fn := range settleHooks {
		fn(app)
	}
}

func integrate(app core.App) {
	aggregateMu.Lock()
	defer aggregateMu.Unlock()
	consolidating.Store(true)
	defer consolidating.Store(false)
	if err := consolidate(app); err != nil {
		logger().Error("consolidate failed", "error", err)
	}
}

// WaitSettled blocks while a consolidation is in progress and returns once the
// map is quiescent. Readers that reason over the whole map (discover) call it
// first, so a run kicked mid-consolidation reads the version about to land
// rather than the one about to be superseded.
func WaitSettled() {
	aggregateMu.Lock()
	//nolint:staticcheck // the lock is the wait; nothing to protect
	aggregateMu.Unlock()
}
