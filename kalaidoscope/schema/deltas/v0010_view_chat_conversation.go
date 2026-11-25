package deltas

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// v10: add view_chat_conversation exposing each conversation alongside its
// earliest non-system chat_message.content for single-query history previews.
func init() {
	schema.RegisterDelta(schema.Delta{
		Version: 10,
		Scope:   schema.ScopeCore,
		Name:    "view_chat_conversation",
		Up: func(app core.App) error {
			return schema.AddCollection(app, schema.TableDef{
				Name: "view_chat_conversation",
				Type: "view",
				ViewQuery: `
			SELECT
				cc.id as id,
				cc.external_conversation_id as external_conversation_id,
				cc.generate_with_model as generate_with_model,
				cc.created as created,
				(SELECT cm.content
				 FROM chat_message cm
				 WHERE cm.chat_conversation_id = cc.id
				   AND COALESCE(json_extract(cm.content, '$.role'), '') != 'system'
				 ORDER BY cm.created ASC, cm.id ASC
				 LIMIT 1) as first_message_content
			FROM chat_conversation cc
		`,
			})
		},
	})
}
