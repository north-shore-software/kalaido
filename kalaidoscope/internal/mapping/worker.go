package mapping

import (
	"context"
	"errors"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/followup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const (
	annotateWorkers = 100
)

// Worker is the map worker: it annotates fragments on demand (Signal,
// SignalAnnotate) and consolidates the map on a timer or when a full cycle
// is asked for. One per process, owned by the server; Run drives both loops.
type Worker struct {
	app        core.App
	signal     chan struct{} // buffered by one: wakes coalesce
	wantSettle atomic.Bool
	followUps  followup.Queue

	annotating     atomic.Bool
	drainErrMu     sync.Mutex
	lastDrainError string

	// aggregateMu is held for the whole of a consolidation; WaitSettled
	// takes it to block until the map is quiescent.
	aggregateMu   sync.Mutex
	consolidating atomic.Bool
	// settleHooks run after every cycle, outside the aggregate lock, so
	// readers that derive from the map (colour membership) follow it
	// without this package knowing them. Register before Run.
	settleHooks []func(core.App)
}

// NewWorker builds the worker over app. Nothing runs until Run.
func NewWorker(app core.App) *Worker {
	return &Worker{app: app, signal: make(chan struct{}, 1)}
}

// Annotating reports whether an annotate drain is in progress.
func (w *Worker) Annotating() bool { return w.annotating.Load() }

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
	select {
	case w.signal <- struct{}{}:
	default:
	}
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
	g.Go(func() error { return w.aggregateLoop(ctx) })
	return g.Wait()
}

func (w *Worker) annotateLoop(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-w.signal:
		}
		active := w.followUps.Take()
		full := w.wantSettle.Swap(false)
		w.annotating.Store(true)
		err := w.drain(ctx, full)
		w.annotating.Store(false)
		w.setLastDrainError(err)
		if err != nil && !errors.Is(err, context.Canceled) {
			logger().Error("drain failed", "error", err)
		}
		followup.Run(active, err)
	}
}

func annotatedIDs(app core.App) (map[string]bool, error) {
	recs, err := app.FindRecordsByFilter(schema.ColFragmentAnnotation.String(), "1=1", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(recs))
	for _, r := range recs {
		ids[r.GetString("fragment_id")] = true
	}
	return ids, nil
}

func pendingFragments(app core.App) ([]*core.Record, error) {
	done, err := annotatedIDs(app)
	if err != nil {
		return nil, err
	}
	recs, err := app.FindRecordsByFilter(schema.ColFragment.String(), "deleted_at = ''", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	var pending []*core.Record
	for _, r := range recs {
		if !done[r.Id] {
			pending = append(pending, r)
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		li, lj := pending[i].GetString("ingested_via") == "import", pending[j].GetString("ingested_via") == "import"
		if li != lj {
			return !li
		}
		return pending[i].GetDateTime("occurred_at").Compare(pending[j].GetDateTime("occurred_at")) < 0
	})
	return pending, nil
}

func pendingCount(app core.App) (int, error) {
	pending, err := pendingFragments(app)
	if err != nil {
		return 0, err
	}
	return len(pending), nil
}

// drain annotates every pending fragment, annotateWorkers at a time, until
// none is left or the quota is exhausted; a fragment that fails is skipped
// for the rest of this drain. With full, the map is then consolidated.
func (w *Worker) drain(ctx context.Context, full bool) error {
	app := w.app
	model, err := llm.ResolveRole(llm.RoleAnnotate)
	if err != nil {
		return err
	}
	failed := map[string]bool{}
	var firstErr error
	var mu sync.Mutex
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		frags, err := pendingFragments(app)
		if err != nil {
			return err
		}
		var todo []*core.Record
		for _, f := range frags {
			if !failed[f.Id] {
				todo = append(todo, f)
			}
		}
		if len(todo) == 0 {
			break
		}
		var exhausted atomic.Bool
		g := new(errgroup.Group)
		g.SetLimit(annotateWorkers)
		for _, f := range todo {
			if exhausted.Load() || ctx.Err() != nil {
				break
			}
			g.Go(func() error {
				err := annotateOne(ctx, app, model, f)
				if err == nil {
					return nil
				}
				logger().Error("annotate failed", "fragment_id", f.Id, "error", err)
				mu.Lock()
				failed[f.Id] = true
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				if errors.Is(err, usage.ErrExhausted) {
					exhausted.Store(true)
				}
				return nil // recorded above; one failure must not stop the others
			})
		}
		_ = g.Wait()
		if exhausted.Load() {
			break
		}
	}
	if full && ctx.Err() == nil {
		w.settle(ctx)
	}
	return firstErr
}
