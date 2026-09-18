package server

import (
	"context"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/colour"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/handlers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// shutdownGrace bounds how long terminate waits for the workers and the
// background runner to drain before the process exits regardless.
const shutdownGrace = 10 * time.Second

// runtime owns the process's background workers and the runner for detached
// work. It builds them at construction, wires their hooks, starts them when
// the app serves, and drains them when it terminates.
type runtime struct {
	colour    *colour.Worker
	mapping   *mapping.Worker
	reconcile *reconcile.Worker
	discover  *discover.Worker
	runner    *engine.TrackedRunner
	scheduler *llmq.Scheduler

	ctx    context.Context
	cancel context.CancelFunc
	group  *errgroup.Group
}

func newRuntime(app core.App, opts Options) *runtime {
	ctx, cancel := context.WithCancel(context.Background())
	rt := &runtime{
		colour:    colour.NewWorker(app),
		mapping:   mapping.NewWorker(app),
		reconcile: reconcile.NewWorker(app, reconcile.Options{AutoWave: opts.AutoWave}),
		runner:    engine.NewTrackedRunner(ctx),
		scheduler: llmq.New(llmq.ConfigForProvider(llm.ActiveProviderID())),
		cancel:    cancel,
	}
	app.Store().Set(usage.SchedulerStoreKey, rt.scheduler)
	rt.discover = discover.NewWorker(app, rt.mapping)
	rt.group, ctx = errgroup.WithContext(ctx)

	// Order matters: colour recomputes thing-backed membership from the
	// settled map, then the wave regenerates whatever that membership feeds.
	rt.mapping.OnSettle(rt.colour.OnMapSettled)
	rt.mapping.OnSettle(rt.reconcile.OnMapSettled)
	rt.colour.OnDrained(rt.reconcile.EnqueueWave)

	rt.ctx = ctx
	return rt
}

func (rt *runtime) Scheduler() *llmq.Scheduler {
	return rt.scheduler
}

func (rt *runtime) deps() handlers.Deps {
	return handlers.Deps{
		Colour:    rt.colour,
		Mapping:   rt.mapping,
		Reconcile: rt.reconcile,
		Discover:  rt.discover,
		Runner:    rt.runner,
	}
}

// bind starts the workers once the app serves and drains them when it
// terminates. Starting at serve, not at construction, means a process that
// only runs a command (or a test that only bootstraps) starts no goroutine.
func (rt *runtime) bind(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		rt.start()
		return nil
	})
	app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		rt.stop()
		return te.Next()
	})
}

func (rt *runtime) start() {
	rt.group.Go(func() error { return rt.colour.Run(rt.ctx) })
	rt.group.Go(func() error { return rt.mapping.Run(rt.ctx) })
	rt.group.Go(func() error { return rt.reconcile.Run(rt.ctx) })
	rt.group.Go(func() error { return rt.discover.Run(rt.ctx) })

	// Boot kicks: work left by a crash or an offline provider resumes from
	// the state in the database.
	rt.colour.Signal()
	rt.mapping.KickIfPending()
	rt.reconcile.LogPolicy()
	rt.reconcile.EnqueueWave()
}

// stop cancels every worker and detached task and waits, bounded, for them
// to return so no write is cut off mid-transaction.
func (rt *runtime) stop() {
	rt.cancel()
	done := make(chan struct{})
	go func() {
		_ = rt.group.Wait()
		rt.runner.Wait()
		close(done)
	}()
	select {
	case <-done:
		logger().Info("workers drained")
	case <-time.After(shutdownGrace):
		logger().Warn("workers still running at shutdown; exiting anyway", "grace", shutdownGrace)
	}
}
