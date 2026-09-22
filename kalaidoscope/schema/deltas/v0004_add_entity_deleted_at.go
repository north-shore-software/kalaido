// UNREVIEWED
package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v4: projection and reflection gain a soft-delete stamp. Existing rows keep
// an empty deleted_at, i.e. live.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 4,
		Scope:   schema.ScopeCore,
		Name:    "add_entity_deleted_at",
		Up: func(app core.App) error {
			for _, name := range []string{"projection", "reflection"} {
				err := schema.Modify(app, name, func(c *core.Collection) error {
					c.Fields.Add(&core.DateField{Name: "deleted_at"})
					c.AddIndex("idx_"+name+"_deleted_at", false, "deleted_at", "")
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
