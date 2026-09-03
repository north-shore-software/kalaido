package ingest

import (
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
)

func startPipeline() {
	mapping.AfterDrain(func(err error) {
		if err != nil {
			return
		}
		discover.Signal("colours")
		discover.Signal("projections")
		discover.Signal("reflections")
	})
	mapping.Signal()
}
