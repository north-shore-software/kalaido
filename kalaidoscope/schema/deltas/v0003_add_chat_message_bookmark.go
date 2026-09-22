package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v3: chat_message gains the bookmark mark and the fragment it was saved as.
// Modify does not resolve relation targets by name, so the fragment
// collection's id is looked up here.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 3,
		Scope:   schema.ScopeCore,
		Name:    "add_chat_message_bookmark",
		Up: func(app core.App) error {
			frag, err := app.FindCollectionByNameOrId("fragment")
			if err != nil {
				return err
			}
			return schema.Modify(app, "chat_message", func(c *core.Collection) error {
				c.Fields.Add(&core.BoolField{Name: "bookmarked"})
				c.Fields.Add(&core.RelationField{Name: "fragment_id", CollectionId: frag.Id, MaxSelect: 1})
				return nil
			})
		},
	})
}
