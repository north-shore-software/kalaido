package server

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
)

const queueStatusCollection = "llm_queue_status"

// registerQueueStatus mirrors the LLM scheduler's state into the singleton
// llm_queue_status record, so the frontend watches the queue over the same
// realtime channel as any other collection. Writes are debounced: transitions
// arrive in bursts (enqueue + admit + release), and every write fans out an
// SSE event. The mirror starts when the app serves and stops when it
// terminates, so no timer outlives the database it writes to.
func registerQueueStatus(app core.App, sched *queue.Scheduler) {
	m := &queueMirror{app: app}
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// A previous process's state is meaningless to this one.
		writeQueueStatus(app, queue.Status{})
		sched.SetOnChange(m.onChange)
		return se.Next()
	})
	app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		sched.SetOnChange(nil)
		m.stop()
		return te.Next()
	})
}

// queueMirror debounces scheduler transitions into one record write.
type queueMirror struct {
	app core.App

	mu      sync.Mutex
	latest  queue.Status
	timer   *time.Timer // the pending flush, nil when none
	stopped bool
}

const queueStatusDebounce = 300 * time.Millisecond

// onChange receives every scheduler transition. Deliveries are async, so
// Version keeps a stale snapshot from overwriting a newer one, and one may
// still arrive after stop: stopped makes it a no-op.
func (m *queueMirror) onChange(st queue.Status) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopped || st.Version <= m.latest.Version {
		return
	}
	m.latest = st
	if m.timer != nil {
		return
	}
	m.timer = time.AfterFunc(queueStatusDebounce, m.flush)
}

func (m *queueMirror) flush() {
	m.mu.Lock()
	st, stopped := m.latest, m.stopped
	m.timer = nil
	m.mu.Unlock()
	if stopped {
		return
	}
	writeQueueStatus(m.app, st)
}

// stop cancels the pending flush and refuses further ones. A flush that has
// already fired sees stopped under the lock and writes nothing.
func (m *queueMirror) stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopped = true
	if m.timer != nil {
		m.timer.Stop()
		m.timer = nil
	}
}

func writeQueueStatus(app core.App, st queue.Status) {
	var rec *core.Record
	if recs, err := app.FindAllRecords(queueStatusCollection); err == nil && len(recs) > 0 {
		rec = recs[0]
	} else {
		col, err := app.FindCollectionByNameOrId(queueStatusCollection)
		if err != nil {
			logger(app).Error("queue status collection unavailable", "error", err)
			return
		}
		rec = core.NewRecord(col)
	}

	state := "idle"
	if len(st.Running) > 0 || len(st.Waiting) > 0 {
		state = "active"
	}
	if st.Running == nil {
		st.Running = []queue.TaskInfo{}
	}
	if st.Waiting == nil {
		st.Waiting = map[string]int{}
	}
	running, _ := json.Marshal(st.Running)
	waiting, _ := json.Marshal(st.Waiting)
	held, _ := json.Marshal(st.Held)

	rec.Set("state", state)
	rec.Set("running", string(running))
	rec.Set("waiting", string(waiting))
	rec.Set("held", string(held))
	if err := app.Save(rec); err != nil {
		logger(app).Error("queue status save failed", "error", err)
	}
}
