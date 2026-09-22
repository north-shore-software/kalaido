package deltas

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v2: fragment.type gains "edit" — a passage of a generated document the user
// rewrote by hand. Values are spelled out; a delta never reads Canonical.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 2,
		Scope:   schema.ScopeCore,
		Name:    "add_fragment_type_edit",
		Up: func(app core.App) error {
			return schema.Modify(app, "fragment", func(c *core.Collection) error {
				f, ok := c.Fields.GetByName("type").(*core.SelectField)
				if !ok {
					return fmt.Errorf("fragment.type is not a select field")
				}
				f.Values = []string{"email", "note", "chat", "edit"}
				return nil
			})
		},
	})
}
