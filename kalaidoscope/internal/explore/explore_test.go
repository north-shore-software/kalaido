// UNREVIEWED
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
