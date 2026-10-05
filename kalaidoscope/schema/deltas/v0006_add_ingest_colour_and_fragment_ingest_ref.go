package deltas

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v6: an import can tag its fragments with a colour. ingest gains colour_id,
// fragment gains ingest_ref (which ingest produced it), and
// colour_fragment.match_type gains "ingest" for the rows an import writes.
// Values are spelled out; a delta never reads Canonical.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 6,
		Scope:   schema.ScopeCore,
		Name:    "add_ingest_colour_and_fragment_ingest_ref",
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
			if err := schema.Modify(app, "fragment", func(c *core.Collection) error {
				c.Fields.Add(&core.TextField{Name: "ingest_ref"})
				c.AddIndex("idx_fragment_ingest_ref", false, "ingest_ref", "")
				return nil
			}); err != nil {
				return err
			}
			return schema.Modify(app, "colour_fragment", func(c *core.Collection) error {
				f, ok := c.Fields.GetByName("match_type").(*core.SelectField)
				if !ok {
					return fmt.Errorf("colour_fragment.match_type is not a select field")
				}
				f.Values = []string{"manual_positive", "manual_negative", "ingest", "thing", "prompt"}
				return nil
			})
		},
	})
}
