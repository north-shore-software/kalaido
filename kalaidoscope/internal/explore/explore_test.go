package explore

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func specMessage(t *testing.T, id string, spec api.ContextSpec) api.UIMessage {
	t.Helper()
	b, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	return api.UIMessage{ID: id, Role: "system", Parts: []api.UIMessagePart{{Type: "context_spec", Data: b}}}
}

func TestPrepareLLMPromptAndSummaries(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "THE FULL BODY"})

	ctx := context.Background()
	resolve := func(history []api.UIMessage, m api.UIMessage) []api.UIMessage {
		batch := []api.UIMessage{m}
		chat.ResolveContextSpecs(ctx, app, history, batch)
		return append(history, batch...)
	}
	user := api.UIMessage{ID: "u1", Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: "hello"}}}
	history := append(resolve(nil, specMessage(t, "s1", api.ContextSpec{WholeScope: api.WholeScopeFull})), user)

	if ConversationSummaries(history) {
		t.Fatal("full-mode transcript reports summaries")
	}

	prompt := PrepareLLMPrompt(ctx, app, nil, history)
	if prompt[0].Content != prompts.ChatSystemPrompt {
		t.Errorf("PrepareLLMPrompt full mode system prompt mismatch: %q", prompt[0].Content)
	}

	// Turn summaries on
	history = resolve(history, specMessage(t, "s2", api.ContextSpec{WholeScope: api.WholeScopeSummaries}))
	if !ConversationSummaries(history) {
		t.Fatal("summaries transcript not reported")
	}

	prompt = PrepareLLMPrompt(ctx, app, nil, history)
	if !strings.Contains(prompt[0].Content, prompts.ChatSummariesLegend) {
		t.Errorf("PrepareLLMPrompt summaries legend missing: %q", prompt[0].Content)
	}
}

func TestViewChatConversation(t *testing.T) {
	app := testutil.NewApp(t)
	ctx := context.Background()

	// 1. System message followed by user and assistant turns (forced to the same
	// created timestamp so rowid breaks the tie deterministically) -> picks user text.
	convUser, err := FindOrCreateConversation(ctx, app, "ext-user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convUser, specMessage(t, "s1", api.ContextSpec{WholeScope: api.WholeScopeFull}), ""); err != nil {
		t.Fatal(err)
	}
	uRec, err := chat.PersistMessage(ctx, app, convUser, api.UIMessage{
		ID:   "u1",
		Role: "user",
		Parts: []api.UIMessagePart{
			{Type: "text", Text: "first "},
			{Type: "text", Text: "question"},
		},
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	aRec, err := chat.PersistMessage(ctx, app, convUser, api.UIMessage{
		ID:    "a1",
		Role:  "assistant",
		Parts: []api.UIMessagePart{{Type: "text", Text: "first answer"}},
	}, "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB().NewQuery(
		"UPDATE chat_message SET created = '2026-11-01 10:00:00.000Z' WHERE id IN ({:u}, {:a})",
	).Bind(map[string]any{"u": uRec.Id, "a": aRec.Id}).Execute(); err != nil {
		t.Fatal(err)
	}

	// 2. System-opened conversation with an opening assistant turn -> picks assistant text.
	convAssistant, err := FindOrCreateConversation(ctx, app, "ext-assistant")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convAssistant, specMessage(t, "s2", api.ContextSpec{WholeScope: api.WholeScopeFull}), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convAssistant, api.UIMessage{
		ID:    "a2",
		Role:  "assistant",
		Parts: []api.UIMessagePart{{Type: "text", Text: "good morning"}},
	}, "model-a"); err != nil {
		t.Fatal(err)
	}

	// 3. Tool-only non-system message followed by a message with text -> skips tool-only row.
	convToolFirst, err := FindOrCreateConversation(ctx, app, "ext-tool-first")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convToolFirst, api.UIMessage{
		ID:    "t1",
		Role:  "assistant",
		Parts: []api.UIMessagePart{{Type: "tool-read_fragment", Data: json.RawMessage(`{"ids":["f1"]}`)}},
	}, "model-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convToolFirst, api.UIMessage{
		ID:    "u2",
		Role:  "user",
		Parts: []api.UIMessagePart{{Type: "text", Text: "follow up with text"}},
	}, ""); err != nil {
		t.Fatal(err)
	}

	// 4. Long text message is capped at 500 characters in the view.
	convLong, err := FindOrCreateConversation(ctx, app, "ext-long")
	if err != nil {
		t.Fatal(err)
	}
	longText := strings.Repeat("x", 800)
	if _, err := chat.PersistMessage(ctx, app, convLong, api.UIMessage{
		ID:    "u-long",
		Role:  "user",
		Parts: []api.UIMessagePart{{Type: "text", Text: longText}},
	}, ""); err != nil {
		t.Fatal(err)
	}

	// 5. System-only conversation -> still present in view with empty preview.
	convSysOnly, err := FindOrCreateConversation(ctx, app, "ext-sys-only")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convSysOnly, specMessage(t, "s3", api.ContextSpec{}), ""); err != nil {
		t.Fatal(err)
	}

	// 6. Empty conversation -> still present in view with empty preview.
	if _, err := FindOrCreateConversation(ctx, app, "ext-empty"); err != nil {
		t.Fatal(err)
	}

	rows, err := app.FindAllRecords("view_chat_conversation")
	if err != nil {
		t.Fatalf("query view_chat_conversation: %v", err)
	}
	if len(rows) != 6 {
		t.Fatalf("got %d rows, want 6", len(rows))
	}

	byExt := map[string]string{}
	for _, r := range rows {
		byExt[r.GetString("external_conversation_id")] = r.GetString("preview")
	}

	want := map[string]string{
		"ext-user":       "first question",
		"ext-assistant":  "good morning",
		"ext-tool-first": "follow up with text",
		"ext-long":       strings.Repeat("x", 500),
		"ext-sys-only":   "",
		"ext-empty":      "",
	}
	for k, w := range want {
		if got := byExt[k]; got != w {
			t.Errorf("%s preview = %q (len %d), want %q (len %d)", k, got, len(got), w, len(w))
		}
	}

	// Verify the composite index satisfies ORDER BY created, rowid without a temp sort.
	var plan []struct {
		Detail string `db:"detail"`
	}
	if err := app.DB().NewQuery("EXPLAIN QUERY PLAN SELECT * FROM view_chat_conversation").All(&plan); err != nil {
		t.Fatalf("explain query plan: %v", err)
	}
	var usesIndex, hasTempSort bool
	for _, row := range plan {
		if strings.Contains(row.Detail, "idx_chat_message_chat_conv_created") {
			usesIndex = true
		}
		if strings.Contains(row.Detail, "USE TEMP B-TREE FOR ORDER BY") {
			hasTempSort = true
		}
	}
	if !usesIndex || hasTempSort {
		t.Errorf("unexpected query plan (usesIndex=%v hasTempSort=%v): %+v", usesIndex, hasTempSort, plan)
	}
}
