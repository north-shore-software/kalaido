// UNREVIEWED
package workerutil

import "context"

// Signal is a coalescing event notification channel. Senders wake the worker
// without blocking or queuing multiple redundant events; receivers block until
// signaled or until the context is canceled.
type Signal struct {
	ch chan struct{}
}

// NewSignal creates a buffered signal of capacity 1.
func NewSignal() Signal {
	return Signal{ch: make(chan struct{}, 1)}
}

// Notify requests a wake-up. If a notification is already pending in the
// buffer, it coalesces without blocking the caller.
func (s Signal) Notify() {
	select {
	case s.ch <- struct{}{}:
	default:
	}
}

// C exposes the underlying channel for select statements or tests.
func (s Signal) C() <-chan struct{} {
	return s.ch
}

// Wait blocks until a notification arrives or ctx is done.
// Returns ctx.Err() if the context is cancelled before or while waiting.
func (s Signal) Wait(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-s.ch:
		return nil
	}
}
