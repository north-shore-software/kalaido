package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
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

// The mode is the conversation's current one, applied to the whole history:
// a transcript whose latest spec asks for summaries renders every delta as
// rows (so a turn that failed in full mode recovers), and turning summaries
// off re-renders the same ids as full bodies.
func TestHydrateDeltaHistoryUsesCurrentMode(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "THE FULL BODY"})
	testutil.NewRecord(t, app, "fragment_annotation", map[string]any{
		"fragment_id": frag.Id, "title": "A note", "summary": "It says something.",
	})
	ctx := context.Background()

	// ResolveContextSpecs stamps pinned_ids onto the slice it is handed.
	resolve := func(history []api.UIMessage, m api.UIMessage) []api.UIMessage {
		batch := []api.UIMessage{m}
		ResolveContextSpecs(ctx, app, history, batch)
		return append(history, batch...)
	}
	user := api.UIMessage{ID: "u1", Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: "hello"}}}
	history := append(resolve(nil, specMessage(t, "s1", api.ContextSpec{WholeScope: true})), user)

	// Full mode: the body.
	msgs := HydrateDeltaHistory(ctx, app, history)
	if len(msgs) != 2 || !strings.Contains(msgs[0].Content, "THE FULL BODY") {
		t.Fatalf("full mode = %+v", msgs)
	}
	if ConversationSummaries(history) {
		t.Fatal("full-mode transcript reports summaries")
	}

	// Summaries turned on after the fact: the earlier delta renders as a row,
	// the repeated spec adds nothing.
	history = resolve(history, specMessage(t, "s2", api.ContextSpec{WholeScope: true, Summaries: true}))
	msgs = HydrateDeltaHistory(ctx, app, history)
	if len(msgs) != 2 {
		t.Fatalf("summaries mode = %d messages, want 2 (repeated spec adds nothing): %+v", len(msgs), msgs)
	}
	if strings.Contains(msgs[0].Content, "THE FULL BODY") || !strings.Contains(msgs[0].Content, "A note") {
		t.Errorf("summaries mode did not re-render the earlier delta as rows: %q", msgs[0].Content)
	}
	if !ConversationSummaries(history) {
		t.Error("summaries transcript not reported")
	}
	prompt := PrepareLLMPrompt(ctx, app, nil, history)
	if !strings.Contains(prompt[0].Content, prompts.ChatSummariesLegend) {
		t.Error("PrepareLLMPrompt did not pick the summaries system prompt")
	}

	// Off again: bodies come back.
	history = resolve(history, specMessage(t, "s3", api.ContextSpec{WholeScope: true}))
	msgs = HydrateDeltaHistory(ctx, app, history)
	if !strings.Contains(msgs[0].Content, "THE FULL BODY") {
		t.Errorf("full mode did not come back: %q", msgs[0].Content)
	}
	prompt = PrepareLLMPrompt(ctx, app, nil, history)
	if prompt[0].Content != prompts.ChatSystemPrompt {
		t.Error("PrepareLLMPrompt did not fall back to the plain system prompt")
	}
}
