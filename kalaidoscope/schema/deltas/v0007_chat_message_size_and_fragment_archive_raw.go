package deltas

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v7: chat_message.content grows to 8 MB (an assistant turn persists every
// read_fragment output it made, and a few large reads outgrew PocketBase's
// 1 MB default, losing the turn); a fragment can be archived (archived_at,
// kept and still readable, exposed on view_stream so surfaces can hide it
// themselves), can carry its original text in raw_content once content has
// been cleaned, and can be named by the user (title, shown over the
// annotation's title). The view is restated in full; a delta never reads
// Canonical.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 7,
		Scope:   schema.ScopeCore,
		Name:    "chat_message_size_and_fragment_archive_raw",
		Up: func(app core.App) error {
			if err := schema.Modify(app, "chat_message", func(c *core.Collection) error {
				f, ok := c.Fields.GetByName("content").(*core.JSONField)
				if !ok {
					return fmt.Errorf("chat_message.content is not a json field")
				}
				f.MaxSize = 8 << 20
				return nil
			}); err != nil {
				return err
			}
			if err := schema.Modify(app, "fragment", func(c *core.Collection) error {
				c.Fields.Add(&core.DateField{Name: "archived_at"})
				c.Fields.Add(&core.TextField{Name: "raw_content", Max: 100_000_000})
				c.Fields.Add(&core.TextField{Name: "title"})
				c.AddIndex("idx_fragment_archived_at", false, "archived_at", "")
				return nil
			}); err != nil {
				return err
			}
			return schema.Modify(app, "view_stream", func(c *core.Collection) error {
				c.ViewQuery = `
			SELECT
				f.id as id,
				f.type as type,
				f.content as content,
				f.occurred_at as occurred_at,
				f.created as created,
				f.archived_at as archived_at,
				CAST(COALESCE(NULLIF(f.title, ''), fa.title) AS TEXT) as title,
				COALESCE(
					(SELECT json_group_array(cf.colour_id)
					 FROM colour_fragment cf
					 WHERE cf.fragment_id = f.id
					   AND cf.match_type != 'manual_negative'),
					'[]'
				) as colour_ids
			FROM fragment f
			LEFT JOIN fragment_annotation fa ON fa.fragment_id = f.id
			WHERE f.deleted_at = ''
		`
				return nil
			})
		},
	})
}
