package ingest

import (
	"log"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

func startPipeline(app core.App, recID string) {
	setPipeline(app, recID, "mapping", nil)
	mapping.AfterDrain(func(err error) {
		if err != nil {
			setPipeline(app, recID, "error", err)
			return
		}
		setPipeline(app, recID, "organizing", nil)
		discover.AfterDrain(func(err error) {
			if err != nil {
				setPipeline(app, recID, "error", err)
				return
			}
			setPipeline(app, recID, "done", nil)
		})
		discover.Signal("colours")
		discover.Signal("projections")
		discover.Signal("reflections")
	})
	mapping.Signal()
}

func setPipeline(app core.App, recID string, stage string, cause error) {
	rec, err := app.FindRecordById("ingest", recID)
	if err != nil {
		log.Printf("ingest: pipeline %s: reload record %s: %v", stage, recID, err)
		return
	}
	rec.Set("pipeline", stage)
	if cause != nil {
		rec.Set("pipeline_error", cause.Error())
	}
	if err := app.Save(rec); err != nil {
		log.Printf("ingest: pipeline %s: save %s: %v", stage, recID, err)
	}
}
