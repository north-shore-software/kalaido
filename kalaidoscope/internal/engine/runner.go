// UNREVIEWED
package engine

import (
	"context"
	"sync"
)

// TrackedRunner is the process's Runner: every task runs under one parent
// context and is counted, so shutdown can cancel them all and wait.
type TrackedRunner struct {
	ctx context.Context
	wg  sync.WaitGroup
}

// NewTrackedRunner runs tasks under ctx.
func NewTrackedRunner(ctx context.Context) *TrackedRunner {
	return &TrackedRunner{ctx: ctx}
}

// Go runs f on its own goroutine with the runner's context.
func (r *TrackedRunner) Go(f func(ctx context.Context)) {
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		f(r.ctx)
	}()
}

// Wait blocks until every task started so far has returned.
func (r *TrackedRunner) Wait() { r.wg.Wait() }

// InlineRunner runs each task to completion on the caller's goroutine, for
// tests that want the work done before they assert.
type InlineRunner struct{}

func (InlineRunner) Go(f func(ctx context.Context)) { f(context.Background()) }

// DiscardRunner drops every task, for tests that exercise only the request
// path and must not start work that would outlive their app.
type DiscardRunner struct{}

func (DiscardRunner) Go(func(ctx context.Context)) {}
