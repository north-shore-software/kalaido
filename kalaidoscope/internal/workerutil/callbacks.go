// UNREVIEWED
package workerutil

import "sync"

// Callbacks accumulates one-shot callbacks pending execution after a work pass.
type Callbacks struct {
	mu      sync.Mutex
	pending []func(error)
}

// Add queues a one-shot callback to run after the next work pass ends.
func (c *Callbacks) Add(fn func(error)) {
	c.mu.Lock()
	c.pending = append(c.pending, fn)
	c.mu.Unlock()
}

// Detach removes and returns all callbacks registered up to this point.
// Any callbacks added after Detach will remain pending for the next pass.
func (c *Callbacks) Detach() CallbackBatch {
	c.mu.Lock()
	batch := c.pending
	c.pending = nil
	c.mu.Unlock()
	return CallbackBatch(batch)
}

// CallbackBatch is a detached slice of one-shot callbacks to execute.
type CallbackBatch []func(error)

// Invoke calls each callback in the batch with err.
func (b CallbackBatch) Invoke(err error) {
	for _, fn := range b {
		fn(err)
	}
}
