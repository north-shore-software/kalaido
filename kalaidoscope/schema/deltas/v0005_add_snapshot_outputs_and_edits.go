package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

const longTextMax = 100_000_000

func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 5,
		Scope:   schema.ScopeCore,
		Name:    "add_snapshot_outputs_and_edits",
		Up: func(app core.App) error {
			for _, name := range []string{"projection_snapshot", "reflection_snapshot"} {
				err := schema.Modify(app, name, func(c *core.Collection) error {
					c.Fields.Add(&core.TextField{Name: "output_raw", Max: longTextMax})
					c.Fields.Add(&core.TextField{Name: "output_draft", Max: longTextMax})
					c.Fields.Add(&core.JSONField{Name: "edits"})
					return nil
				})
				if err != nil {
					return err
				}
			}

			for _, name := range []string{"projection_snapshot", "reflection_snapshot"} {
				_, err := app.DB().NewQuery("UPDATE " + name + " SET output_draft = output WHERE status = 'pending_review' AND (output_draft IS NULL OR output_draft = '')").Execute()
				if err != nil {
					return err
				}
			}
			return nil
		},
	})
}
