package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/handlers"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workers"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// shutdownGrace bounds how long terminate waits for the workers and the
// background runner to drain before the process exits regardless.
const shutdownGrace = 10 * time.Second

// runtime owns the process's background workers and the runner for detached
// work. It builds them at construction, wires their hooks, starts them when
// the app serves, and drains them when it terminates.
type runtime struct {
	workers   *workers.Manager
	runner    *engine.TrackedRunner
	scheduler *llmq.Scheduler
	logger    *slog.Logger

	ctx    context.Context
	cancel context.CancelFunc
	group  *errgroup.Group
}

func newRuntime(app core.App, opts Options) *runtime {
	ctx, cancel := context.WithCancel(context.Background())
	mgr := workers.New(app, workers.Options{AutoWave: opts.AutoWave})
	rt := &runtime{
		workers:   mgr,
		runner:    engine.NewTrackedRunner(ctx),
		scheduler: llmq.New(llmq.ConfigForProvider(llm.ActiveProviderID())),
		logger:    logger(app),
		cancel:    cancel,
	}
	app.Store().Set(usage.SchedulerStoreKey, rt.scheduler)
	rt.group, ctx = errgroup.WithContext(ctx)
	rt.ctx = ctx
	return rt
}

func (rt *runtime) Scheduler() *llmq.Scheduler {
	return rt.scheduler
}

func (rt *runtime) deps() handlers.Deps {
	return handlers.Deps{
		Manager: rt.workers,
		Runner:  rt.runner,
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
	rt.workers.Start(rt.ctx, rt.group)
	rt.workers.BootKicks()
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
		rt.logger.Info("workers drained")
	case <-time.After(shutdownGrace):
		rt.logger.Warn("workers still running at shutdown; exiting anyway", "grace", shutdownGrace)
	}
}
