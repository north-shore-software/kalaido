package ingest

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// restartedError is what a swept record reports.
const restartedError = "server restarted while processing"

// SweepPending fails every ingest record a previous run left in progress. A
// record is pending only while its goroutine runs in this process, and that
// goroutine holds the uploads in memory, so anything pending at boot belongs
// to a run that crashed or was killed and can never complete; without this
// the client would watch it forever.
func SweepPending(app core.App) {
	recs, err := app.FindRecordsByFilter(schema.ColIngest.String(), "status = 'pending'", "", 0, 0)
	if err != nil {
		logger(app).Error("sweep pending ingest lookup failed", "error", err)
		return
	}
	for _, r := range recs {
		r.Set("status", "error")
		r.Set("error", restartedError)
		if err := app.Save(r); err != nil {
			logger(app).Error("sweep pending ingest save failed", "record_id", r.Id, "error", err)
		}
	}
	if len(recs) > 0 {
		logger(app).Warn("failed ingest records left pending by a previous run", "count", len(recs))
	}
}
