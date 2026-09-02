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

// The refinement prompt's instructions must quote the exact tool names the
// handler advertises — the constants are wire identifiers, so a drifted quote
// silently detaches the instruction from the tool it governs.
func TestRefinementToolInstructions(t *testing.T) {
	for _, name := range []string{UpdateLensToolName, SuggestNameToolName} {
		if !strings.Contains(RefinementSystemPrompt, `"`+name+`"`) {
			t.Errorf("RefinementSystemPrompt does not quote tool %q", name)
		}
	}
	if !strings.Contains(RefinementSystemPrompt, `"suggested_name"`) {
		t.Error("RefinementSystemPrompt does not mention update_lens's suggested_name argument")
	}
}

// The blindness guard: apply_result is a wire identifier the chat model must
// never learn about — its output must not be solicited, and the prompt must
// state the model's epistemic position and the data-agnosticism hard rules
// carried over from the distillation generator.
func TestRefinementPromptEpistemics(t *testing.T) {
	if strings.Contains(RefinementSystemPrompt, ApplyResultToolName) {
		t.Errorf("RefinementSystemPrompt mentions %q — the model must not know the apply channel exists", ApplyResultToolName)
	}
	for _, marker := range []string{
		"NEVER see the document",         // epistemic position
		"data-agnostic",                  // hard rule 1
		"8 in total",                     // the count-pin worked example
		"The lens must stand alone",      // hard rule 3
		"Never encode a guessed reading", // clarify-with-a-guess
	} {
		if !strings.Contains(RefinementSystemPrompt, marker) {
			t.Errorf("RefinementSystemPrompt lost the %q contract", marker)
		}
	}
}

// Summaries mode composes the ordinary chat prompt with its legend and the
// digest, and quotes the two read tools the handler advertises. The row and
// stub lines must carry the "(ID: x)" join the legend tells the model to pass
// to read_fragment.
func TestChatSummariesPromptComposition(t *testing.T) {
	p := ChatSummariesSystemPrompt("THE DIGEST")
	for _, want := range []string{ChatSystemPrompt, MentionLegend, ChatSummariesLegend, "THE DIGEST", ReadFragmentToolName, ReadThingToolName} {
		if !strings.Contains(p, want) {
			t.Errorf("ChatSummariesSystemPrompt lacks %q", want)
		}
	}
	row := SummaryRowLine(AnnotationRow{FragmentID: "f1", Date: "2026-01-02", Title: "Lift quote", Summary: "A quote arrived.", Things: []ThingCitation{{Ref: "t1"}, {Name: "Acme", Kind: "organisation"}}}, map[string]string{"t1": "Lifts"})
	for _, want := range []string{"(ID: f1)", "Lifts (t1)", "Acme", "2026-01-02"} {
		if !strings.Contains(row, want) {
			t.Errorf("SummaryRowLine lacks %q: %q", want, row)
		}
	}
	stub := SummaryStubLine("note", "inbox", "f2", "", "opening words")
	for _, want := range []string{"(ID: f2;", "not yet annotated", DiscoverUndated, "opening words"} {
		if !strings.Contains(stub, want) {
			t.Errorf("SummaryStubLine lacks %q: %q", want, stub)
		}
	}
	long := strings.Repeat("word ", 100)
	if got := SummarySnippet(long); len([]rune(got)) != SummarySnippetChars+1 || !strings.HasSuffix(got, "…") {
		t.Errorf("SummarySnippet did not cut to %d runes: %d %q", SummarySnippetChars, len([]rune(got)), got)
	}
	if got := SummarySnippet("a  b\n\nc"); got != "a b c" {
		t.Errorf("SummarySnippet did not collapse whitespace: %q", got)
	}
}
