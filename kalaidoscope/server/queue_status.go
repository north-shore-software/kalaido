package server

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
)

const queueStatusCollection = "llm_queue_status"

// registerQueueStatus mirrors the LLM scheduler's state into the singleton
// llm_queue_status record, so the frontend watches the queue over the same
// realtime channel as any other collection. Writes are debounced: transitions
// arrive in bursts (enqueue + admit + release), and every write fans out an
// SSE event.
func registerQueueStatus(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// A previous process's state is meaningless to this one.
		writeQueueStatus(app, llmq.Status{})

		var mu sync.Mutex
		var latest llmq.Status
		var pending bool
		llmq.SetOnChange(func(st llmq.Status) {
			mu.Lock()
			defer mu.Unlock()
			// Deliveries are async; Version keeps a stale snapshot from
			// overwriting a newer one.
			if st.Version <= latest.Version {
				return
			}
			latest = st
			if pending {
				return
			}
			pending = true
			time.AfterFunc(300*time.Millisecond, func() {
				mu.Lock()
				st := latest
				pending = false
				mu.Unlock()
				writeQueueStatus(app, st)
			})
		})
		return se.Next()
	})
}

func writeQueueStatus(app core.App, st llmq.Status) {
	var rec *core.Record
	if recs, err := app.FindAllRecords(queueStatusCollection); err == nil && len(recs) > 0 {
		rec = recs[0]
	} else {
		col, err := app.FindCollectionByNameOrId(queueStatusCollection)
		if err != nil {
			log.Printf("queue status: collection unavailable: %v", err)
			return
		}
		rec = core.NewRecord(col)
	}

	state := "idle"
	if len(st.Running) > 0 || len(st.Waiting) > 0 {
		state = "active"
	}
	if st.Running == nil {
		st.Running = []llmq.TaskInfo{}
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
		log.Printf("queue status: save failed: %v", err)
	}
}
