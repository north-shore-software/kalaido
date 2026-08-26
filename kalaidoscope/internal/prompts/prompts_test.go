package prompts

import (
	"strings"
	"testing"
)

// Both conversational prompts must carry the mention legend, and the legend's
// promises must hold against the formats it describes: the fragment join key
// ("ID: ...") appears in both FragmentMention and FragmentBlock, and snapshot
// blocks carry the quoted name a projection/reflection mention joins on.
func TestMentionLegendComposition(t *testing.T) {
	for name, prompt := range map[string]string{
		"ChatSystemPrompt":       ChatSystemPrompt,
		"RefinementSystemPrompt": RefinementSystemPrompt,
	} {
		if !strings.Contains(prompt, MentionLegend) {
			t.Errorf("%s does not include MentionLegend", name)
		}
	}

	if !strings.Contains(FragmentMention("label", "id123"), "Fragment ID: id123") {
		t.Errorf("FragmentMention lost the ID join key: %q", FragmentMention("label", "id123"))
	}
	if !strings.Contains(FragmentBlock("note", "src", "id123", "body"), "(ID: id123)") {
		t.Errorf("FragmentBlock lost the ID header: %q", FragmentBlock("note", "src", "id123", "body"))
	}
	if !strings.Contains(ProjectionSnapshotBlock("Weekly Digest", "snap1", "out"), `"Weekly Digest"`) {
		t.Errorf("ProjectionSnapshotBlock lost the quoted name: %q", ProjectionSnapshotBlock("Weekly Digest", "snap1", "out"))
	}
	if !strings.Contains(ProjectionMention("Weekly Digest", "proj1"), `@"Weekly Digest"`) {
		t.Errorf("ProjectionMention lost the quoted name join key: %q", ProjectionMention("Weekly Digest", "proj1"))
	}
}

// The snapshot delta turn is checked by the engine with trimmed equality
// against SnapshotNoChanges, so the prompt must quote that exact sentinel and
// carry the previous output it asks to be compared against.
func TestSnapshotDeltaPromptContract(t *testing.T) {
	p := SnapshotDeltaPrompt("PREV DOC")
	if !strings.Contains(p, "PREV DOC") {
		t.Error("SnapshotDeltaPrompt does not carry the previous output")
	}
	if !strings.Contains(p, `"`+SnapshotNoChanges+`"`) {
		t.Errorf("SnapshotDeltaPrompt does not quote the sentinel %q", SnapshotNoChanges)
	}
	if !strings.Contains(SnapshotMergePrompt(), "verbatim") {
		t.Error("SnapshotMergePrompt lost the verbatim-reproduction instruction")
	}
}

// The refinement prompt's naming instructions must quote the exact tool names
// the handler advertises — the constants are wire identifiers, so a drifted
// quote silently detaches the instruction from the tool it governs.
func TestNameSuggestionInstructions(t *testing.T) {
	for _, name := range []string{UpdateDraftToolName, SuggestNameToolName} {
		if !strings.Contains(RefinementSystemPrompt, `"`+name+`"`) {
			t.Errorf("RefinementSystemPrompt does not quote tool %q", name)
		}
	}
	if !strings.Contains(RefinementSystemPrompt, `"suggested_name"`) {
		t.Error("RefinementSystemPrompt does not mention update_draft's suggested_name argument")
	}
}
