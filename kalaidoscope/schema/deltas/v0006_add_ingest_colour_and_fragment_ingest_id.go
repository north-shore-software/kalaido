package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 6,
		Scope:   schema.ScopeCore,
		Name:    "add_ingest_colour_and_fragment_ingest_id",
		Up: func(app core.App) error {
			col, err := app.FindCollectionByNameOrId("colour")
			if err != nil {
				return err
			}
			if err := schema.Modify(app, "ingest", func(c *core.Collection) error {
				c.Fields.Add(&core.RelationField{Name: "colour_id", CollectionId: col.Id, MaxSelect: 1})
				return nil
			}); err != nil {
				return err
			}
			return schema.Modify(app, "fragment", func(c *core.Collection) error {
				c.Fields.Add(&core.TextField{Name: "ingest_id"})
				c.AddIndex("idx_fragment_ingest_id", false, "ingest_id", "")
				return nil
			})
		},
	})
}
