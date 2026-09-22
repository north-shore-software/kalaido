// UNREVIEWED
package engine

import (
	"sync"
)

// claimHub tells in-process waiters the moment a generation claim settles
// (filled, released or discarded), so AwaitGeneration need not poll the row
// to learn it. The row stays the durable state: a waiter re-reads it on
// every wake, and the poll remains as a fallback for a claim this process
// did not settle itself.
type claimHub struct {
	mu      sync.Mutex
	waiters map[string][]chan struct{}
}

// claims is the process-wide hub. Claim ids are unique per database, so one
// hub serves every app in the process (tests boot several).
var claims = &claimHub{waiters: map[string][]chan struct{}{}}

// subscribe returns a channel closed when claimID next settles. Call
// unsubscribe with it when done waiting, whether or not it fired.
func (h *claimHub) subscribe(claimID string) chan struct{} {
	ch := make(chan struct{})
	h.mu.Lock()
	h.waiters[claimID] = append(h.waiters[claimID], ch)
	h.mu.Unlock()
	return ch
}

func (h *claimHub) unsubscribe(claimID string, ch chan struct{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := h.waiters[claimID]
	for i, c := range list {
		if c == ch {
			list = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(list) == 0 {
		delete(h.waiters, claimID)
	} else {
		h.waiters[claimID] = list
	}
}

// settle wakes every waiter on claimID.
func (h *claimHub) settle(claimID string) {
	h.mu.Lock()
	list := h.waiters[claimID]
	delete(h.waiters, claimID)
	h.mu.Unlock()
	for _, ch := range list {
		close(ch)
	}
}
