package mapping

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

func logger() *slog.Logger {
	return slog.Default().With("component", "mapping")
}

// Worker is the map worker: it annotates fragments on demand (Signal,
// SignalAnnotate) and consolidates the map on a timer or when a full cycle
// is asked for. One per process, owned by the server; Run drives both loops.
type Worker struct {
	app        core.App
	logger     *slog.Logger
	signal     workerutil.Signal
	wantSettle atomic.Bool
	followUps  workerutil.Callbacks

	annotating     atomic.Bool
	drainErrMu     sync.Mutex
	lastDrainError string

	// consolidateMu is held for the whole of a consolidation; WaitSettled
	// takes it to block until the map is quiescent.
	consolidateMu sync.Mutex
	consolidating atomic.Bool
	// settleHooks run after every cycle, outside the consolidate lock, so
	// readers that derive from the map (colour membership) follow it
	// without this package knowing them. Register before Run.
	settleHooks []func(core.App)
}

// NewWorker builds the worker over app. Nothing runs until Run.
func NewWorker(app core.App) *Worker {
	return &Worker{app: app, logger: logger(), signal: workerutil.NewSignal()}
}

// Annotating reports whether an annotate drain is in progress.
func (w *Worker) Annotating() bool { return w.annotating.Load() }

// Consolidating reports whether a consolidation is in progress.
func (w *Worker) Consolidating() bool { return w.consolidating.Load() }

func (w *Worker) WantSettle() bool { return w.wantSettle.Load() }

// WaitSettled blocks while a consolidation is in progress and returns once the
// map is quiescent. Readers that reason over the whole map (discover) call it
// first, so a run kicked mid-consolidation reads the version about to land
// rather than the one about to be superseded.
func (w *Worker) WaitSettled() {
	w.consolidateMu.Lock()
	//nolint:staticcheck // the lock is the wait; nothing to protect
	w.consolidateMu.Unlock()
}

// LastDrainError is the error that ended the most recent drain, or "".
func (w *Worker) LastDrainError() string {
	w.drainErrMu.Lock()
	defer w.drainErrMu.Unlock()
	return w.lastDrainError
}

func (w *Worker) setLastDrainError(err error) {
	w.drainErrMu.Lock()
	defer w.drainErrMu.Unlock()
	if err == nil {
		w.lastDrainError = ""
		return
	}
	w.lastDrainError = err.Error()
}

// Signal asks for a full cycle: annotate everything pending, then settle
// the map. Coalesces.
func (w *Worker) Signal() {
	w.wantSettle.Store(true)
	w.SignalAnnotate()
}

// SignalAnnotate asks for an annotate drain only; consolidation waits for
// the timer. Coalesces.
func (w *Worker) SignalAnnotate() {
	w.signal.Notify()
}

// AfterDrain runs fn once the next drain ends, with its error.
func (w *Worker) AfterDrain(fn func(err error)) {
	w.followUps.Add(fn)
}

// OnSettle registers a hook to run after each map cycle. Register before Run.
func (w *Worker) OnSettle(fn func(core.App)) {
	w.settleHooks = append(w.settleHooks, fn)
}

// KickIfPending signals an annotate drain when fragments await annotation,
// so work left by a crash or an offline provider resumes at boot.
func (w *Worker) KickIfPending() {
	if n, err := pendingCount(w.app); err == nil && n > 0 {
		w.SignalAnnotate()
	}
}

// Run drives the annotate loop and the consolidate timer until ctx is
// cancelled, then returns ctx.Err() once both have stopped.
func (w *Worker) Run(ctx context.Context) error {
	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() error { return w.annotateLoop(ctx) })
	g.Go(func() error { return w.consolidateLoop(ctx) })
	return g.Wait()
}
