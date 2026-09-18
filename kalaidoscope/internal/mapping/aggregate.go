package mapping

import (
	"context"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	consolidatePendingFloor = 50
	consolidateStaleAge     = time.Minute
	aggregateTick           = 10 * time.Second
)

// Consolidating reports whether a consolidation is in progress.
func (w *Worker) Consolidating() bool { return w.consolidating.Load() }

func (w *Worker) aggregateLoop(ctx context.Context) error {
	ticker := time.NewTicker(aggregateTick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
		due, err := consolidateDue(w.app, time.Now())
		if err != nil {
			logger().Error("consolidate check failed", "error", err)
			continue
		}
		if due {
			w.cycle(ctx)
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

func (w *Worker) settle(ctx context.Context) {
	w.cycle(ctx)
}

func (w *Worker) cycle(ctx context.Context) {
	w.integrate(ctx)
	for _, fn := range w.settleHooks {
		fn(w.app)
	}
}

func (w *Worker) integrate(ctx context.Context) {
	w.aggregateMu.Lock()
	defer w.aggregateMu.Unlock()
	w.consolidating.Store(true)
	defer w.consolidating.Store(false)
	if err := consolidate(ctx, w.app); err != nil {
		logger().Error("consolidate failed", "error", err)
	}
}

// WaitSettled blocks while a consolidation is in progress and returns once the
// map is quiescent. Readers that reason over the whole map (discover) call it
// first, so a run kicked mid-consolidation reads the version about to land
// rather than the one about to be superseded.
func (w *Worker) WaitSettled() {
	w.aggregateMu.Lock()
	//nolint:staticcheck // the lock is the wait; nothing to protect
	w.aggregateMu.Unlock()
}
