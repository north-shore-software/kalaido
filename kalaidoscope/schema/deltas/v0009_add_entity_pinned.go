package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 9,
		Scope:   schema.ScopeCore,
		Name:    "add_entity_pinned",
		Up: func(app core.App) error {
			for _, name := range []string{"projection", "reflection"} {
				err := schema.Modify(app, name, func(c *core.Collection) error {
					c.Fields.Add(&core.BoolField{Name: "pinned"})
					return nil
				})
				if err != nil {
					return err
				}
			}
			return nil
		},
	})
}
