// UNREVIEWED
package explore

import (
	"context"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// FragmentKind is the fragment type a saved explore turn gets.
// Matches the "chat" type enum on the fragment collection.
const FragmentKind = "chat"

// FragmentSource is the provenance a saved turn carries: the conversation's
// client id and the turn's UIMessage id, so the fragment points back at the
// exact message. Free text by design (source is never parsed).
func FragmentSource(clientID, messageID string) string {
	return fmt.Sprintf("explore:%s:%s", clientID, messageID)
}

// MessageText is what a turn says: its text parts joined, with a user turn's
// @-mentions reduced to their labels — the fragment keeps what the person
// read, not the wire token. Empty for a tool-only turn.
func MessageText(m api.UIMessage) string {
	var parts []string
	for _, p := range m.Parts {
		if p.Type != "text" || strings.TrimSpace(p.Text) == "" {
			continue
		}
		parts = append(parts, strings.TrimSpace(p.Text))
	}
	text := strings.Join(parts, "\n\n")
	if m.Role == "user" {
		text = llmcontext.StripMentions(text)
	}
	return strings.TrimSpace(text)
}

// SaveBookmarks turns every bookmarked turn of the conversation into a
// fragment, in one transaction, and stamps each row with the fragment it
// became. Idempotent: a row that already points at a live fragment is reused
// (a soft-deleted one is not — the user removed it, so re-saving is a fresh
// act). Tool-only turns with no text are skipped, not an error.
//
// Fragments are created directly rather than through the ingest writer:
// this must be transactional, and the writer's content-hash dedupe would
// silently drop a legitimately repeated text. The fragment create hooks
// (defaults, colour and annotate signals) fire on save as usual.
func SaveBookmarks(ctx context.Context, app core.App, conv *core.Record) ([]api.SavedBookmark, error) {
	var saved []api.SavedBookmark
	clientID := conv.GetString("external_conversation_id")

	err := app.RunInTransaction(func(tx core.App) error {
		rows, err := tx.FindRecordsByFilter(
			"chat_message",
			"chat_conversation_id = {:cid} && bookmarked = true",
			"created", 0, 0,
			dbx.Params{"cid": conv.Id},
		)
		if err != nil {
			return err
		}
		fragCol, err := tx.FindCollectionByNameOrId(schema.ColFragment.String())
		if err != nil {
			return err
		}
		for _, row := range rows {
			msg, err := chat.MessageFromRecord(row)
			if err != nil || msg.Role == "system" {
				continue
			}
			content := MessageText(msg)
			if content == "" {
				continue
			}

			if existing := row.GetString("fragment_id"); existing != "" {
				if frag, err := tx.FindRecordById(schema.ColFragment.String(), existing); err == nil && frag.GetString("deleted_at") == "" {
					saved = append(saved, api.SavedBookmark{MessageID: msg.ID, FragmentID: existing})
					continue
				}
			}

			frag := core.NewRecord(fragCol)
			frag.Set("type", FragmentKind)
			frag.Set("ingested_via", "app")
			frag.Set("source", FragmentSource(clientID, msg.ID))
			frag.Set("content", content)
			// The turn's own time, so the fragment sits where the
			// conversation happened rather than when it was saved.
			frag.Set("occurred_at", row.GetDateTime("created"))
			if err := tx.Save(frag); err != nil {
				return fmt.Errorf("save bookmark %s: %w", msg.ID, err)
			}
			row.Set("fragment_id", frag.Id)
			if err := tx.Save(row); err != nil {
				return fmt.Errorf("stamp bookmark %s: %w", msg.ID, err)
			}
			saved = append(saved, api.SavedBookmark{MessageID: msg.ID, FragmentID: frag.Id, Created: true})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if saved == nil {
		saved = []api.SavedBookmark{}
	}
	return saved, nil
}
