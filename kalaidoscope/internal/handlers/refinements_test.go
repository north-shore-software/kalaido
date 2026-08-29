package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// newRefinement opens an empty projection refinement conversation.
func newRefinement(t *testing.T, app core.App) *core.Record {
	t.Helper()

	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "target"})
	return testutil.NewRecord(t, app, "refine_proj_snapshot_conversation", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "client-1",
	})
}

func raw(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func persist(t *testing.T, app core.App, ref *core.Record, msg api.UIMessage) {
	t.Helper()
	if _, err := chat.PersistMessage(context.Background(), app, ref, msg, ""); err != nil {
		t.Fatalf("persist: %v", err)
	}
}

// lensTurn builds an assistant message the way the chat handler persists one:
// the update_lens tool part, and — when the apply succeeded — the apply_result
// part beside it on the same message.
func lensTurn(t *testing.T, id, lens, output string) api.UIMessage {
	t.Helper()
	parts := []api.UIMessagePart{
		{Type: "tool-" + prompts.UpdateLensToolName, Data: raw(t, map[string]any{
			"toolCallId": id + "-lens",
			"toolName":   prompts.UpdateLensToolName,
			"input":      map[string]string{"lens": lens},
		})},
	}
	if output != "" {
		parts = append(parts, api.UIMessagePart{
			Type: "tool-" + prompts.ApplyResultToolName, Data: raw(t, map[string]any{
				"toolCallId": id + "-apply",
				"toolName":   prompts.ApplyResultToolName,
				"input":      map[string]string{"output": output},
			})})
	}
	return api.UIMessage{ID: id, Role: "assistant", Parts: parts}
}

// The commit payload is the newest lens together with the output of that same
// turn's apply — never a newer lens paired with an older output.
func TestExtractPairsLensWithItsOwnApply(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)

	persist(t, app, ref, lensTurn(t, "turn-1", "LENS V1", "OUTPUT V1"))
	persist(t, app, ref, lensTurn(t, "turn-2", "LENS V2", "OUTPUT V2"))

	lens, output, _, _, _, err := ExtractDraftedLensAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if lens != "LENS V2" || output != "OUTPUT V2" {
		t.Errorf("extract = (%q, %q), want the newest turn's pair", lens, output)
	}
}

// A clarify turn (no lens) after a drafting turn must not hide the draft.
func TestExtractSkipsClarifyTurns(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)

	persist(t, app, ref, lensTurn(t, "turn-1", "LENS V1", "OUTPUT V1"))
	persist(t, app, ref, api.UIMessage{ID: "turn-2", Role: "assistant", Parts: []api.UIMessagePart{
		{Type: "text", Text: "Cut the third bullet — do you mean the invoice material?"},
	}})

	lens, output, _, _, _, err := ExtractDraftedLensAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if lens != "LENS V1" || output != "OUTPUT V1" {
		t.Errorf("extract = (%q, %q), want the drafting turn's pair", lens, output)
	}
}

// A lens whose apply failed extracts with an empty output — the commit handler
// refuses it rather than committing a lens the user never previewed.
func TestExtractLensWithFailedApplyHasNoOutput(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)

	persist(t, app, ref, lensTurn(t, "turn-1", "LENS V1", "OUTPUT V1"))
	persist(t, app, ref, lensTurn(t, "turn-2", "LENS V2", ""))

	lens, output, _, _, _, err := ExtractDraftedLensAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if lens != "LENS V2" {
		t.Errorf("lens = %q, want the newest lens", lens)
	}
	if output != "" {
		t.Errorf("output = %q, want empty (that turn's apply never landed)", output)
	}
}

// A seeded session carries context only: with no chat turn there is no lens,
// and the commit handler turns that into a 400 — the zero-turn approve-as-is
// flow is gone by design.
func TestExtractSeededContextOnlyHasNoLens(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)

	fragment := testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "chat", "content": "the graduated answer",
	})
	spec := api.ContextSpec{FragmentIDs: []string{fragment.Id}}

	// Exactly what the create handler seeds: the spec, plus its resolution.
	persist(t, app, ref, api.UIMessage{
		ID:   "ctx-1",
		Role: "system",
		Parts: []api.UIMessagePart{
			{Type: "context_spec", Data: raw(t, spec)},
			{Type: "pinned_ids", Data: raw(t, map[string]any{
				"fragmentIds": []string{fragment.Id},
			})},
		},
	})

	lens, output, pinned, gotSpec, _, err := ExtractDraftedLensAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if lens != "" || output != "" {
		t.Errorf("extract = (%q, %q), want no lens and no output", lens, output)
	}
	if len(pinned.FragmentIDs) != 1 || pinned.FragmentIDs[0] != fragment.Id {
		t.Errorf("resolved context = %v, want [%s]", pinned.FragmentIDs, fragment.Id)
	}
	if len(gotSpec.FragmentIDs) != 1 || gotSpec.FragmentIDs[0] != fragment.Id {
		t.Errorf("context spec = %v, want the seeded spec", gotSpec.FragmentIDs)
	}
}
