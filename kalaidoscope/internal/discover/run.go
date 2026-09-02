package discover

import (
	"log"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
)

func newRun(app core.App, kind string, version int, model string) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId("discover_run")
	if err != nil {
		return nil, err
	}
	run := core.NewRecord(col)
	run.Set("kind", kind)
	run.Set("status", "running")
	run.Set("map_version", version)
	run.Set("model", model)
	run.Set("rounds", 0)
	run.Set("fragment_reads", 0)
	run.Set("outputs", pbutil.JSONObject([]Output{}))
	if err := app.Save(run); err != nil {
		return nil, err
	}
	return run, nil
}

func (c *Context) saveProgress() {
	outputs := c.outputs
	if outputs == nil {
		outputs = []Output{}
	}
	c.Run.Set("rounds", c.rounds)
	c.Run.Set("fragment_reads", c.Reads())
	c.Run.Set("outputs", pbutil.JSONObject(outputs))
	if err := c.App.Save(c.Run); err != nil {
		log.Printf("discover: save run: %v", err)
	}
}

func finishRun(c *Context, err error) {
	if err != nil {
		c.Run.Set("status", "error")
		c.Run.Set("error", err.Error())
	} else {
		c.Run.Set("status", "done")
	}
	c.saveProgress()
}
