package mapping

import (
	"log"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	consolidatePendingFloor = 50
	consolidateStaleAge     = time.Minute
	aggregateTick           = 10 * time.Second
)

var aggregateMu sync.Mutex

func aggregateLoop() {
	for range time.Tick(aggregateTick) {
		due, err := consolidateDue(workerApp, time.Now())
		if err != nil {
			log.Printf("mapping: consolidate check: %v", err)
			continue
		}
		if due {
			cycle(workerApp)
			continue
		}
		if err := refreshCounters(workerApp); err != nil {
			log.Printf("mapping: counters: %v", err)
		}
	}
}

func consolidateDue(app core.App, now time.Time) (bool, error) {
	rows, err := app.FindRecordsByFilter("fragment_annotation", "folded = false", "-created", 0, 0, nil)
	if err != nil || len(rows) == 0 {
		return false, err
	}
	if len(rows) > consolidatePendingFloor {
		return true, nil
	}
	newest := rows[0].GetDateTime("created").Time()
	return now.Sub(newest) > consolidateStaleAge, nil
}

func settle(app core.App) {
	cycle(app)
}

func cycle(app core.App) {
	aggregateMu.Lock()
	defer aggregateMu.Unlock()
	if err := consolidate(app); err != nil {
		log.Printf("mapping: consolidate: %v", err)
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
	if d.rec.GetInt("fragments") == int(fragments) && d.rec.GetInt("annotated") == int(annotated) {
		return nil
	}
	d.rec.Set("fragments", fragments)
	d.rec.Set("annotated", annotated)
	return app.Save(d.rec)
}

// WaitSettled blocks while a consolidation is in progress and returns once the
// map is quiescent. Readers that reason over the whole map (discover) call it
// first, so a run kicked mid-consolidation reads the version about to land
// rather than the one about to be superseded.
func WaitSettled() {
	aggregateMu.Lock()
	//nolint:staticcheck // the lock is the wait; nothing to protect
	aggregateMu.Unlock()
}
