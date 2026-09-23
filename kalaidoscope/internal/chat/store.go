package chat

import (
	"context"
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// MessageFromRecord decodes the UIMessage a chat_message row stores.
func MessageFromRecord(r *core.Record) (api.UIMessage, error) {
	var m api.UIMessage
	err := json.Unmarshal([]byte(r.GetString("content")), &m)
	return m, err
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
