package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v10: index chat_message(chat_conversation_id, created) and add
// view_chat_conversation exposing each conversation alongside a truncated text
// preview from its earliest non-system message carrying text.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 10,
		Scope:   schema.ScopeCore,
		Name:    "view_chat_conversation",
		Up: func(app core.App) error {
			if err := schema.Modify(app, "chat_message", func(c *core.Collection) error {
				c.AddIndex("idx_chat_message_chat_conv_created", false, "chat_conversation_id, created", "")
				return nil
			}); err != nil {
				return err
			}
			return schema.AddCollection(app, schema.TableDef{
				Name: "view_chat_conversation",
				Type: "view",
				ViewQuery: `
			SELECT
				cc.id as id,
				cc.external_conversation_id as external_conversation_id,
				cc.generate_with_model as generate_with_model,
				cc.created as created,
				CAST(COALESCE(
					(SELECT substr(
						(SELECT group_concat(json_extract(p.value, '$.text'), '')
						 FROM json_each(cm.content, '$.parts') p
						 WHERE json_extract(p.value, '$.type') = 'text'),
						1, 500
					)
					 FROM chat_message cm
					 WHERE cm.chat_conversation_id = cc.id
					   AND json_valid(cm.content)
					   AND COALESCE(json_extract(cm.content, '$.role'), '') != 'system'
					   AND json_type(cm.content, '$.parts') = 'array'
					   AND EXISTS (
					       SELECT 1
					       FROM json_each(cm.content, '$.parts') p
					       WHERE json_extract(p.value, '$.type') = 'text'
					         AND trim(COALESCE(json_extract(p.value, '$.text'), '')) != ''
					   )
					 ORDER BY cm.created ASC, cm.rowid ASC
					 LIMIT 1),
					''
				) AS TEXT) as preview
			FROM chat_conversation cc
		`,
			})
		},
	})
}
