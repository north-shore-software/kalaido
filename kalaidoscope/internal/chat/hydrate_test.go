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

// Rendering follows the final context: a fragment pinned mid-conversation in
// summaries mode shows its full body from its first appearance, and the pin
// itself is not a delta.
func TestHydrateDeltaHistoryRendersByFinalContext(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "THE FULL BODY"})
	testutil.NewRecord(t, app, "fragment_annotation", map[string]any{
		"fragment_id": frag.Id, "title": "A note", "summary": "It says something.",
	})
	ctx := context.Background()
	resolve := func(history []api.UIMessage, m api.UIMessage) []api.UIMessage {
		batch := []api.UIMessage{m}
		ResolveContextSpecs(ctx, app, history, batch)
		return append(history, batch...)
	}
	history := resolve(nil, specMessage(t, "s1", api.ContextSpec{WholeScope: true, Summaries: true}))
	history = resolve(history, specMessage(t, "s2", api.ContextSpec{WholeScope: true, Summaries: true, FragmentIDs: []string{frag.Id}}))

	msgs := HydrateDeltaHistory(ctx, app, history)
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1 (the pin is not a delta): %+v", len(msgs), msgs)
	}
	if !strings.Contains(msgs[0].Content, "THE FULL BODY") || strings.Contains(msgs[0].Content, prompts.SummariesAddedNotice) {
		t.Errorf("pinned fragment should render in full from the start: %q", msgs[0].Content)
	}
}

// Narrowing a whole-scope conversation to a few pins (mode off) must not
// replay the whole scope: fragments gone by the end are omitted as a count,
// and the removal lists only what the model was shown.
func TestHydrateDeltaHistoryOmitsTransientScope(t *testing.T) {
	app := testutil.NewApp(t)
	kept := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "KEPT BODY"})
	for i := 0; i < 3; i++ {
		testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "TRANSIENT BODY"})
	}
	colour := testutil.NewRecord(t, app, "colour", map[string]any{"name": "c"})
	testutil.NewRecord(t, app, "colour_fragment", map[string]any{"colour_id": colour.Id, "fragment_id": kept.Id, "match_type": "prompt"})
	ctx := context.Background()
	resolve := func(history []api.UIMessage, m api.UIMessage) []api.UIMessage {
		batch := []api.UIMessage{m}
		ResolveContextSpecs(ctx, app, history, batch)
		return append(history, batch...)
	}
	history := resolve(nil, specMessage(t, "s1", api.ContextSpec{WholeScope: true, Summaries: true}))
	history = resolve(history, specMessage(t, "s2", api.ContextSpec{WholeScope: true, Summaries: true, ColourIDs: []string{colour.Id}}))
	history = resolve(history, specMessage(t, "s3", api.ContextSpec{ColourIDs: []string{colour.Id}}))

	msgs := HydrateDeltaHistory(ctx, app, history)
	if len(msgs) != 2 {
		t.Fatalf("got %d messages, want 2 (entry, then the narrowing): %+v", len(msgs), msgs)
	}
	first, last := msgs[0].Content, msgs[1].Content
	if !strings.Contains(first, "KEPT BODY") || strings.Contains(first, "TRANSIENT BODY") {
		t.Errorf("entry should carry only the kept body: %q", first)
	}
	if !strings.Contains(first, prompts.OmittedAddedNotice(3)) {
		t.Errorf("entry should count the omitted documents: %q", first)
	}
	if !strings.Contains(last, prompts.OmittedRemovedLine(3)) || strings.Contains(last, "Fragment ID:") {
		t.Errorf("narrowing should close the omitted count and list nothing shown: %q", last)
	}
	if ConversationSummaries(history) {
		t.Error("final mode is off, not summaries")
	}
}

// A scope that leaves and comes back is not rendered twice: the return is a
// restored-count notice pointing at the earlier copy.
func TestHydrateDeltaHistoryRestoresWithoutRerender(t *testing.T) {
	app := testutil.NewApp(t)
	kept := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "KEPT BODY"})
	for i := 0; i < 3; i++ {
		testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "OTHER BODY"})
	}
	colour := testutil.NewRecord(t, app, "colour", map[string]any{"name": "c"})
	testutil.NewRecord(t, app, "colour_fragment", map[string]any{"colour_id": colour.Id, "fragment_id": kept.Id, "match_type": "prompt"})
	ctx := context.Background()
	resolve := func(history []api.UIMessage, m api.UIMessage) []api.UIMessage {
		batch := []api.UIMessage{m}
		ResolveContextSpecs(ctx, app, history, batch)
		return append(history, batch...)
	}
	summaries := api.ContextSpec{WholeScope: true, Summaries: true, ColourIDs: []string{colour.Id}}
	history := resolve(nil, specMessage(t, "s1", summaries))
	history = resolve(history, specMessage(t, "s2", api.ContextSpec{ColourIDs: []string{colour.Id}}))
	history = resolve(history, specMessage(t, "s3", summaries))

	msgs := HydrateDeltaHistory(ctx, app, history)
	if len(msgs) != 3 {
		t.Fatalf("got %d messages, want 3: %+v", len(msgs), msgs)
	}
	entry, narrow, back := msgs[0].Content, msgs[1].Content, msgs[2].Content
	if !strings.Contains(entry, "KEPT BODY") || strings.Count(entry, "not yet annotated") != 3 {
		t.Errorf("entry should show the pin in full and the rest as rows: %q", entry)
	}
	if strings.Count(narrow, "Fragment ID:") != 3 || strings.Contains(narrow, prompts.OmittedRemovedLine(3)) {
		t.Errorf("narrowing should list the three shown rows as removed: %q", narrow)
	}
	if !strings.Contains(back, prompts.RestoredNotice(3)) || strings.Contains(back, "not yet annotated") || strings.Contains(back, prompts.SummariesAddedNotice) {
		t.Errorf("return should be a restored notice, not a re-render: %q", back)
	}
}
