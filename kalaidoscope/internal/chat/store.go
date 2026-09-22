// UNREVIEWED
package chat

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// FindConversation is the plain chat with this client id, or an error. Only
// chat_conversation is searched: a refinement's transcript shares the
// message table but is not a session that gathers material.
func FindConversation(app core.App, clientID string) (*core.Record, error) {
	return app.FindFirstRecordByFilter(
		"chat_conversation",
		"external_conversation_id = {:cid}",
		dbx.Params{"cid": clientID},
	)
}

// FindMessage is the conversation's row whose UIMessage id is messageID.
// Rows are scanned rather than filtered on the JSON column: a conversation
// is at most a few hundred rows, and the id lives inside `content`.
func FindMessage(app core.App, conv *core.Record, messageID string) (*core.Record, error) {
	recs, err := app.FindRecordsByFilter(
		"chat_message",
		"chat_conversation_id = {:cid}",
		"created", 0, 0,
		dbx.Params{"cid": conv.Id},
	)
	if err != nil {
		return nil, err
	}
	for _, r := range recs {
		if m, err := MessageFromRecord(r); err == nil && m.ID == messageID {
			return r, nil
		}
	}
	return nil, fmt.Errorf("message %q not found in conversation %s", messageID, conv.Id)
}

// MessageFromRecord decodes the UIMessage a chat_message row stores.
func MessageFromRecord(r *core.Record) (api.UIMessage, error) {
	var m api.UIMessage
	err := json.Unmarshal([]byte(r.GetString("content")), &m)
	return m, err
}

// MarkOf is the row's bookmark state as the client sees it.
func MarkOf(r *core.Record) api.MessageMark {
	m, _ := MessageFromRecord(r)
	return api.MessageMark{
		MessageID:  m.ID,
		Bookmarked: r.GetBool("bookmarked"),
		FragmentID: r.GetString("fragment_id"),
	}
}

func FindOrCreateConversation(ctx context.Context, app core.App, clientID string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter(
		"chat_conversation",
		"external_conversation_id = {:cid}",
		dbx.Params{"cid": clientID},
	)
	if err == nil {
		return rec, nil
	}

	col, err := app.FindCollectionByNameOrId(schema.ColChatConversation.String())
	if err != nil {
		return nil, err
	}
	rec = core.NewRecord(col)
	rec.Set("external_conversation_id", clientID)
	if err := app.Save(rec); err != nil {
		if existing, e2 := app.FindFirstRecordByFilter(
			"chat_conversation",
			"external_conversation_id = {:cid}",
			dbx.Params{"cid": clientID},
		); e2 == nil {
			return existing, nil
		}
		return nil, err
	}
	return rec, nil
}

func PersistMessage(ctx context.Context, app core.App, conversation *core.Record, msg api.UIMessage, model string) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(schema.ColChatMessage.String())
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(col)

	switch conversation.Collection().Name {
	case "chat_conversation":
		rec.Set("chat_conversation_id", conversation.Id)
	case "projection_refinement":
		rec.Set("projection_refinement_id", conversation.Id)
	case "reflection_refinement":
		rec.Set("reflection_refinement_id", conversation.Id)
	}

	rec.Set("content", types.JSONRaw(b))
	rec.Set("generated_by_model", model)
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func RewriteMessage(app core.App, rec *core.Record, msg api.UIMessage) error {
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	rec.Set("content", types.JSONRaw(b))
	return app.Save(rec)
}

func LoadMessages(ctx context.Context, app core.App, conversation *core.Record) ([]api.UIMessage, error) {
	var fieldName string
	switch conversation.Collection().Name {
	case "chat_conversation":
		fieldName = "chat_conversation_id"
	case "projection_refinement":
		fieldName = "projection_refinement_id"
	case "reflection_refinement":
		fieldName = "reflection_refinement_id"
	default:
		return nil, nil
	}

	recs, err := app.FindRecordsByFilter(
		"chat_message",
		fieldName+" = {:cid}",
		"created", 0, 0,
		dbx.Params{"cid": conversation.Id},
	)
	if err != nil {
		return nil, err
	}
	msgs := make([]api.UIMessage, 0, len(recs))
	for _, r := range recs {
		var m api.UIMessage
		if err := json.Unmarshal([]byte(r.GetString("content")), &m); err == nil {
			msgs = append(msgs, m)
		}
	}
	return msgs, nil
}
