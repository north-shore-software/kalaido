package llmcontext

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

func part(t *testing.T, typ string, data any) api.UIMessagePart {
	t.Helper()
	b, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	return api.UIMessagePart{Type: typ, Data: b}
}

// The isolation invariant: of everything the refinement handler persists on an
// assistant message, only the lens is echoed back into the transcript the
// lens-writing model sees. The applied output especially must stay invisible —
// a lens-writer that sees its lens's output starts encoding output back into
// the lens, which is the overfitting this design exists to remove.
func TestFlattenEchoesOnlyTheLens(t *testing.T) {
	msg := api.UIMessage{
		ID:   "turn-1",
		Role: "assistant",
		Parts: []api.UIMessagePart{
			{Type: "text", Text: "Tightened the selection rule."},
			part(t, "tool-"+prompts.UpdateLensToolName, map[string]any{
				"toolCallId": "c1",
				"toolName":   prompts.UpdateLensToolName,
				"input":      map[string]string{"lens": "THE LENS TEXT"},
			}),
			part(t, "tool-"+prompts.ApplyResultToolName, map[string]any{
				"toolCallId": "c2",
				"toolName":   prompts.ApplyResultToolName,
				"input":      map[string]string{"output": "SECRET APPLIED OUTPUT"},
			}),
			part(t, "tool-"+prompts.SuggestNameToolName, map[string]any{
				"toolCallId": "c3",
				"toolName":   prompts.SuggestNameToolName,
				"input":      map[string]string{"name": "Weekly Digest"},
			}),
			part(t, "data-refine_lint", map[string]string{"match": "8 in total"}),
		},
	}

	flat := Flatten([]api.UIMessage{msg})
	if len(flat) != 1 {
		t.Fatalf("flattened messages = %d, want 1", len(flat))
	}
	content := flat[0].Content
	if !strings.Contains(content, prompts.LensEcho(prompts.UpdateLensToolName, "THE LENS TEXT")) {
		t.Errorf("lens echo missing from flattened content: %q", content)
	}
	if strings.Contains(content, "SECRET APPLIED OUTPUT") {
		t.Fatalf("applied output leaked into the model-facing transcript: %q", content)
	}
	if strings.Contains(content, "Weekly Digest") || strings.Contains(content, "8 in total") {
		t.Errorf("side-channel parts leaked into the model-facing transcript: %q", content)
	}
}

// A legacy tool-update_draft part (pre-lens transcripts) must no longer echo
// anything: the old generic tool-* branch is gone on purpose.
func TestFlattenIgnoresUnknownToolParts(t *testing.T) {
	msg := api.UIMessage{
		ID:   "turn-1",
		Role: "assistant",
		Parts: []api.UIMessagePart{
			part(t, "tool-update_draft", map[string]any{
				"toolCallId": "c1",
				"toolName":   "update_draft",
				"input":      map[string]string{"draft": "OLD DRAFT"},
			}),
		},
	}
	if flat := Flatten([]api.UIMessage{msg}); len(flat) != 0 {
		t.Fatalf("legacy draft part produced model-facing content: %+v", flat)
	}
}

// A summaries-mode turn persists its reads with their output; Flatten replays
// them as the exchange the model saw live — its text plus the echo of the
// calls, a user turn carrying the results, then what it said next — so later
// turns can build on what was read. A read without output (interrupted turn)
// contributes nothing.
func TestFlattenReplaysReadOutputs(t *testing.T) {
	msg := api.UIMessage{
		ID:   "turn-1",
		Role: "assistant",
		Parts: []api.UIMessagePart{
			{Type: "text", Text: "Let me check."},
			part(t, "tool-"+prompts.ReadFragmentToolName, map[string]any{
				"toolCallId": "c1",
				"toolName":   prompts.ReadFragmentToolName,
				"input":      map[string]any{"ids": []string{"f1"}},
				"output":     "--- note from x (ID: f1) ---\nTHE BODY\n\n",
			}),
			part(t, "tool-"+prompts.ReadThingToolName, map[string]any{
				"toolCallId": "c2",
				"toolName":   prompts.ReadThingToolName,
				"input":      map[string]any{"ids": []string{"t1"}},
			}),
			{Type: "text", Text: "The answer."},
		},
	}
	flat := Flatten([]api.UIMessage{msg})
	if len(flat) != 3 {
		t.Fatalf("flattened messages = %d, want 3: %+v", len(flat), flat)
	}
	if flat[0].Role != "assistant" || flat[0].Content != "Let me check."+prompts.DiscoverEchoToolCalls([]string{prompts.ReadFragmentToolName}) {
		t.Errorf("first turn = %+v", flat[0])
	}
	if flat[1].Role != "user" || !strings.Contains(flat[1].Content, "THE BODY") {
		t.Errorf("results turn = %+v", flat[1])
	}
	if flat[2].Role != "assistant" || flat[2].Content != "The answer." {
		t.Errorf("closing turn = %+v", flat[2])
	}
}
