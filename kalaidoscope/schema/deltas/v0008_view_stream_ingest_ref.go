package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v8: view_stream exposes fragment.ingest_ref so the Stream can filter by the
// import that produced a fragment. The view is restated in full; a delta never
// reads Canonical.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 8,
		Scope:   schema.ScopeCore,
		Name:    "view_stream_ingest_ref",
		Up: func(app core.App) error {
			return schema.Modify(app, "view_stream", func(c *core.Collection) error {
				c.ViewQuery = `
			SELECT
				f.id as id,
				f.type as type,
				f.content as content,
				f.occurred_at as occurred_at,
				f.created as created,
				f.archived_at as archived_at,
				f.ingest_ref as ingest_ref,
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
