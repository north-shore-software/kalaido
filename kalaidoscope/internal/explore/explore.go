// UNREVIEWED
package explore

import (
	"context"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/sourcedata"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// FindConversation is the explore conversation with this client id, or an error.
func FindConversation(app core.App, clientID string) (*core.Record, error) {
	return app.FindFirstRecordByFilter(
		"chat_conversation",
		"external_conversation_id = {:cid}",
		dbx.Params{"cid": clientID},
	)
}

// FindOrCreateConversation finds an existing explore conversation by clientID,
// or creates a new one.
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
		if m, err := chat.MessageFromRecord(r); err == nil && m.ID == messageID {
			return r, nil
		}
	}
	return nil, fmt.Errorf("message %q not found in conversation %s", messageID, conv.Id)
}

// MarkOf is the row's bookmark state as the client sees it.
func MarkOf(r *core.Record) api.MessageMark {
	m, _ := chat.MessageFromRecord(r)
	return api.MessageMark{
		MessageID:  m.ID,
		Bookmarked: r.GetBool("bookmarked"),
		FragmentID: r.GetString("fragment_id"),
	}
}

// ConversationSummaries reports whether the transcript's current context spec
// asks for summaries mode. It is the one source of truth for the handler, the
// hydration and the prompt choice.
func ConversationSummaries(allMsgs []api.UIMessage) bool {
	_, spec, _ := llmcontext.LatestPinnedAndSpec(allMsgs)
	return spec.WholeScope == api.WholeScopeSummaries
}

// PrepareLLMPrompt renders the hydrated explore conversation history and prepends
// the appropriate explore system prompt (standard or summaries mode with digest).
func PrepareLLMPrompt(ctx context.Context, app core.App, conv *core.Record, allMsgs []api.UIMessage) []llm.Message {
	hydratedMsgs := chat.HydrateDeltaHistory(ctx, app, allMsgs)
	if len(hydratedMsgs) == 0 {
		return nil
	}
	system := prompts.ChatSystemPrompt
	if ConversationSummaries(allMsgs) {
		digest := ""
		if doc, _, err := sourcedata.LoadDocument(app); err == nil {
			digest = prompts.SummariesMapDigest(doc, prompts.SummariesThingFloor)
		}
		system = prompts.ChatSummariesSystemPrompt(digest)
	}
	return append([]llm.Message{{Role: "system", Content: system}}, hydratedMsgs...)
}
