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

	// 1. System message followed by user and assistant turns -> picks earliest user message.
	convUser, err := FindOrCreateConversation(ctx, app, "ext-user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convUser, specMessage(t, "s1", api.ContextSpec{WholeScope: api.WholeScopeFull}), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convUser, api.UIMessage{
		ID:    "u1",
		Role:  "user",
		Parts: []api.UIMessagePart{{Type: "text", Text: "first question"}},
	}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convUser, api.UIMessage{
		ID:    "a1",
		Role:  "assistant",
		Parts: []api.UIMessagePart{{Type: "text", Text: "first answer"}},
	}, "model-a"); err != nil {
		t.Fatal(err)
	}

	// 2. System-opened conversation with an opening assistant turn -> picks assistant message.
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

	// 3. System-only conversation -> still present in view with empty first_message_content.
	convSysOnly, err := FindOrCreateConversation(ctx, app, "ext-sys-only")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.PersistMessage(ctx, app, convSysOnly, specMessage(t, "s3", api.ContextSpec{}), ""); err != nil {
		t.Fatal(err)
	}

	// 4. Empty conversation -> still present in view with empty first_message_content.
	if _, err := FindOrCreateConversation(ctx, app, "ext-empty"); err != nil {
		t.Fatal(err)
	}

	rows, err := app.FindAllRecords("view_chat_conversation")
	if err != nil {
		t.Fatalf("query view_chat_conversation: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("got %d rows, want 4", len(rows))
	}

	byExt := map[string]string{}
	for _, r := range rows {
		byExt[r.GetString("external_conversation_id")] = r.GetString("first_message_content")
	}

	var uMsg api.UIMessage
	if err := json.Unmarshal([]byte(byExt["ext-user"]), &uMsg); err != nil {
		t.Fatalf("decode ext-user first_message_content (%q): %v", byExt["ext-user"], err)
	}
	if uMsg.ID != "u1" || uMsg.Role != "user" {
		t.Errorf("ext-user first message = %+v, want u1/user", uMsg)
	}

	var aMsg api.UIMessage
	if err := json.Unmarshal([]byte(byExt["ext-assistant"]), &aMsg); err != nil {
		t.Fatalf("decode ext-assistant first_message_content (%q): %v", byExt["ext-assistant"], err)
	}
	if aMsg.ID != "a2" || aMsg.Role != "assistant" {
		t.Errorf("ext-assistant first message = %+v, want a2/assistant", aMsg)
	}

	for _, emptyExt := range []string{"ext-sys-only", "ext-empty"} {
		raw := strings.TrimSpace(byExt[emptyExt])
		if raw != "" && raw != "null" {
			t.Errorf("%s first_message_content = %q, want empty/null", emptyExt, raw)
		}
	}
}
