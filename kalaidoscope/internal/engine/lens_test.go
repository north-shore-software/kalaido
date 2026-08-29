package engine

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestSharesVerbatimRun(t *testing.T) {
	target := "A synthesis tool that ingests messy unstructured inputs and processes them through customizable templates to produce locked documents."
	if !sharesVerbatimRun("The lens says: a synthesis tool that ingests messy unstructured inputs and more", target) {
		t.Error("verbatim 8-word run not detected")
	}
	// Markdown decoration must not hide a copy.
	if !sharesVerbatimRun("**A synthesis** *tool* that `ingests` messy, unstructured inputs and processes...", target) {
		t.Error("markdown-decorated copy not detected")
	}
	if sharesVerbatimRun("Ingests messy unstructured inputs and processes them, then does something entirely different", target) {
		t.Error("7-word overlap should not trip the wire")
	}
	if sharesVerbatimRun("Write a summary of every idea using headings and one italic sentence each.", target) {
		t.Error("unrelated lens tripped the wire")
	}
}

func TestLoadIntentTimelineDeltasInline(t *testing.T) {
	app := testutil.NewApp(t)

	frag1 := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "first idea notes"})
	frag2 := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "second idea notes"})
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "P"})
	ref := testutil.NewRecord(t, app, "refine_proj_snapshot_conversation", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "ext-t1",
	})

	pin := func(ids ...string) json.RawMessage {
		b, _ := json.Marshal(llmcontext.PinnedIDs{FragmentIDs: ids})
		return b
	}
	addMsg := func(id string, msg api.UIMessage) {
		testutil.NewRecord(t, app, "chat_message", map[string]any{
			"refine_proj_conversation_id": ref.Id,
			"content":                     pbutil.JSONObject(msg),
		})
		_ = id
	}
	addMsg("s1", api.UIMessage{ID: "s1", Role: "system", Parts: []api.UIMessagePart{{Type: "pinned_ids", Data: pin(frag1.Id)}}})
	addMsg("m1", api.UIMessage{ID: "m1", Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: "tighten it up"}}})
	// Mid-conversation context change: frag2 joins.
	addMsg("s2", api.UIMessage{ID: "s2", Role: "system", Parts: []api.UIMessagePart{{Type: "pinned_ids", Data: pin(frag1.Id, frag2.Id)}}})
	addMsg("m2", api.UIMessage{ID: "m2", Role: "user", Parts: []api.UIMessagePart{
		{Type: "text", Text: "include the new one"},
		// A draft-bearing tool part must never reach the generator.
		{Type: "tool-update_draft", Text: "SECRET DRAFT"},
	}})

	// Since the conversation ended, frag1 was deleted: the final resolved
	// context is frag2 alone.
	final := llmcontext.PinnedIDs{FragmentIDs: []string{frag2.Id}}
	timeline := loadIntentTimeline(context.Background(), app, ProjectionStrategy{}, proj.Id, ref.Id, final, "unused fallback")

	for _, want := range []string{"first idea notes", "second idea notes", "tighten it up", "include the new one"} {
		if !strings.Contains(timeline, want) {
			t.Errorf("timeline missing %q", want)
		}
	}
	if strings.Contains(timeline, "SECRET DRAFT") {
		t.Error("draft part leaked into the timeline")
	}
	// The mid-chat delta lands between the two user turns.
	if strings.Index(timeline, "tighten it up") > strings.Index(timeline, "second idea notes") {
		t.Error("frag2's content should render after the first user turn")
	}
	if strings.Index(timeline, "second idea notes") > strings.Index(timeline, "include the new one") {
		t.Error("frag2's content should render before the second user turn")
	}
	// The final delta records frag1's removal.
	if !strings.Contains(timeline, "Fragment ID: "+frag1.Id) {
		t.Error("final delta missing frag1's removal line")
	}
	if !strings.Contains(timeline, prompts.HistoryCurrentLabel) {
		t.Error("conversation not labelled as current")
	}
}

func TestLoadIntentTimelineFallbackWithoutPinned(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "P"})
	ref := testutil.NewRecord(t, app, "refine_proj_snapshot_conversation", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "ext-t2",
	})
	testutil.NewRecord(t, app, "chat_message", map[string]any{
		"refine_proj_conversation_id": ref.Id,
		"content": pbutil.JSONObject(api.UIMessage{
			ID: "m1", Role: "user",
			Parts: []api.UIMessagePart{{Type: "text", Text: "make it a haiku"}},
		}),
	})

	timeline := loadIntentTimeline(context.Background(), app, ProjectionStrategy{}, proj.Id, ref.Id, llmcontext.PinnedIDs{}, "THE SOURCE BLOCK")
	if !strings.Contains(timeline, prompts.TimelineSourcesHeading) || !strings.Contains(timeline, "THE SOURCE BLOCK") {
		t.Error("fallback timeline should open with the current sources")
	}
	if !strings.Contains(timeline, "make it a haiku") {
		t.Error("fallback timeline missing the chat turn")
	}
}
