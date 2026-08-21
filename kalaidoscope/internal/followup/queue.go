package followup

import "sync"

type Queue struct {
	mu      sync.Mutex
	pending []func(error)
}

func (q *Queue) Add(fn func(error)) {
	q.mu.Lock()
	q.pending = append(q.pending, fn)
	q.mu.Unlock()
}

func (q *Queue) Take() []func(error) {
	q.mu.Lock()
	active := q.pending
	q.pending = nil
	q.mu.Unlock()
	return active
}

func Run(fns []func(error), err error) {
	for _, fn := range fns {
		fn(err)
	}
}
