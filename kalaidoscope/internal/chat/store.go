package chat

import (
	"context"
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func FindOrCreateConversation(ctx context.Context, app core.App, clientID string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter(
		"chat_conversation",
		"external_conversation_id = {:cid}",
		dbx.Params{"cid": clientID},
	)
	if err == nil {
		return rec, nil
	}

	col, err := app.FindCollectionByNameOrId("chat_conversation")
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
	col, err := app.FindCollectionByNameOrId("chat_message")
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
	case "refine_proj_snapshot_conversation":
		rec.Set("refine_proj_conversation_id", conversation.Id)
	case "refine_refl_snapshot_conversation":
		rec.Set("refine_refl_conversation_id", conversation.Id)
	}

	rec.Set("content", types.JSONRaw(b))
	rec.Set("model", model)
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
	case "refine_proj_snapshot_conversation":
		fieldName = "refine_proj_conversation_id"
	case "refine_refl_snapshot_conversation":
		fieldName = "refine_refl_conversation_id"
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
