package mapping

import (
	"log"
	"sync"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var aggregateSignal = make(chan struct{}, 1)

var aggregateMu sync.Mutex

func signalAggregate() {
	select {
	case aggregateSignal <- struct{}{}:
	default:
	}
}

func aggregateLoop() {
	for range aggregateSignal {
		cycle(workerApp)
	}
}

func settle(app core.App) {
	cycle(app)
}

func cycle(app core.App) {
	aggregateMu.Lock()
	defer aggregateMu.Unlock()
	if _, err := foldPending(app); err != nil {
		log.Printf("mapping: fold: %v", err)
	}
	if err := refreshCounters(app); err != nil {
		log.Printf("mapping: counters: %v", err)
	}
}

func refreshCounters(app core.App) error {
	fragments, err := app.CountRecords("fragment", dbx.NewExp("deleted_at = ''"))
	if err != nil {
		return err
	}
	annotated, err := app.CountRecords("fragment_annotation")
	if err != nil {
		return err
	}
	d, err := loadDocument(app)
	if err != nil {
		return err
	}
	d.rec.Set("fragments", fragments)
	d.rec.Set("annotated", annotated)
	return app.Save(d.rec)
}
