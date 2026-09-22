// UNREVIEWED
package discover

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
)

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "discover")
	}
	return slog.Default().With("component", "discover")
}

// Worker runs the discover flows: Signal marks a kind pending, Run drains the
// pending kinds in pipeline order. One per process, owned by the server.
type Worker struct {
	app    core.App
	logger *slog.Logger
	maps   *mapping.Worker // a run waits for the map to settle first
	wake   workerutil.Signal

	pendingMu sync.Mutex
	pending   map[string]bool
	followUps workerutil.Callbacks

	runningMu      sync.Mutex
	running        string
	currentStarted time.Time
	waitingOnMap   atomic.Bool
}

func (w *Worker) WaitingOnMap() bool {
	return w.waitingOnMap.Load()
}

func (w *Worker) CurrentStarted() time.Time {
	w.runningMu.Lock()
	defer w.runningMu.Unlock()
	return w.currentStarted
}

// NewWorker builds the worker over app. Nothing runs until Run.
func NewWorker(app core.App, maps *mapping.Worker) *Worker {
	return &Worker{app: app, logger: logger(app), maps: maps, wake: workerutil.NewSignal(), pending: map[string]bool{}}
}

// Running is the kind currently running, or "".
func (w *Worker) Running() string {
	w.runningMu.Lock()
	defer w.runningMu.Unlock()
	return w.running
}

func (w *Worker) setRunning(kind string) {
	w.runningMu.Lock()
	w.running = kind
	if kind != "" {
		w.currentStarted = time.Now()
	} else {
		w.currentStarted = time.Time{}
	}
	w.runningMu.Unlock()
}

// Pending lists the kinds signalled but not yet run, in pipeline order.
func (w *Worker) Pending() []string {
	w.pendingMu.Lock()
	defer w.pendingMu.Unlock()
	kinds := make([]string, 0, len(w.pending))
	for _, k := range kindOrder {
		if w.pending[k] {
			kinds = append(kinds, k)
		}
	}
	return kinds
}

// KindOrder is the pipeline order: colours first, so projection and
// reflection scopes can name them.
func KindOrder() []string { return append([]string(nil), kindOrder...) }

// Signal marks kind pending and wakes the worker. An unknown kind is ignored.
func (w *Worker) Signal(kind string) {
	if _, ok := flows[kind]; !ok {
		return
	}
	w.pendingMu.Lock()
	w.pending[kind] = true
	w.pendingMu.Unlock()
	w.wake.Notify()
}

// AfterDrain runs fn once the next drain ends, with its last error.
func (w *Worker) AfterDrain(fn func(err error)) {
	w.followUps.Add(fn)
}

var kindOrder = []string{"colours", "projections", "reflections"}

func (w *Worker) takePending() []string {
	w.pendingMu.Lock()
	defer w.pendingMu.Unlock()
	kinds := make([]string, 0, len(w.pending))
	for _, k := range kindOrder {
		if w.pending[k] {
			kinds = append(kinds, k)
		}
	}
	w.pending = map[string]bool{}
	return kinds
}

// Run drains pending kinds on every wake until ctx is cancelled, then
// returns ctx.Err(). A flow in progress finishes its current round first.
func (w *Worker) Run(ctx context.Context) error {
	for {
		if err := w.wake.Wait(ctx); err != nil {
			return err
		}
		active := w.followUps.Detach()
		var last error
		for _, kind := range w.takePending() {
			if ctx.Err() != nil {
				break
			}
			w.setRunning(kind)
			err := w.run(ctx, flows[kind])
			w.setRunning("")
			if err != nil {
				w.logger.Error("flow run failed", "kind", kind, "error", err)
				last = err
			}
		}
		active.Invoke(last)
	}
}
