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
		"ChatSystemPrompt":           ChatSystemPrompt,
		"ProjectionChatSystemPrompt": ProjectionChatSystemPrompt(false, true, false, "", ""),
		"ReflectionChatSystemPrompt": ReflectionChatSystemPrompt(false, true, "", "", nil),
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

// Anchored projection updates quote the exact SnapshotNoChanges sentinel and
// carry the previous snapshot text.
func TestAnchoredUpdatePromptContract(t *testing.T) {
	p := AnchoredUpdatePrompt("PREV DOC", "BRIEF", "", "NEW NOTE")
	if !strings.Contains(p, "PREV DOC") {
		t.Error("AnchoredUpdatePrompt does not carry the previous output")
	}
	if !strings.Contains(p, "NO_CHANGES") {
		t.Error("AnchoredUpdatePrompt does not quote the NO_CHANGES sentinel")
	}
}

// Projection and reflection chat prompts must quote the exact tool names their
// handlers advertise.
func TestChatPromptToolInstructions(t *testing.T) {
	projDraft := ProjectionChatSystemPrompt(false, true, false, "", "")
	for _, name := range []string{WriteDraftToolName, SuggestNameToolName, UpdateContextToolName} {
		if !strings.Contains(projDraft, `"`+name+`"`) {
			t.Errorf("ProjectionChatSystemPrompt (no draft) does not quote tool %q", name)
		}
	}
	projRevise := ProjectionChatSystemPrompt(true, false, false, "", "existing draft")
	for _, name := range []string{ProposeEditToolName, UpdateDraftToolName, RequestFullRewriteToolName} {
		if !strings.Contains(projRevise, `"`+name+`"`) {
			t.Errorf("ProjectionChatSystemPrompt (has draft) does not quote tool %q", name)
		}
	}
	refl := ReflectionChatSystemPrompt(false, true, "", "", nil)
	for _, name := range []string{SetLensToolName, SuggestNameToolName, UpdateContextToolName} {
		if !strings.Contains(refl, `"`+name+`"`) {
			t.Errorf("ReflectionChatSystemPrompt does not quote tool %q", name)
		}
	}
	if strings.Contains(refl, ApplyResultToolName) {
		t.Errorf("ReflectionChatSystemPrompt mentions internal %q", ApplyResultToolName)
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

// An edit fragment's authority rule must travel inside its block — snapshot
// generation has no system prompt to carry it — and only inside edit blocks,
// so ordinary fragments never pick up an instruction to be kept verbatim.
func TestEditFragmentBlockCarriesGuidance(t *testing.T) {
	edit := FragmentBlock(EditFragmentKind, "src", "id1", EditFragmentContent("old", "new"))
	if !strings.Contains(edit, EditFragmentGuidance) {
		t.Errorf("edit block lacks the guidance line:\n%s", edit)
	}
	for _, want := range []string{EditBeforeMarker, "old", EditAfterMarker, "new", "(ID: id1)"} {
		if !strings.Contains(edit, want) {
			t.Errorf("edit block lacks %q:\n%s", want, edit)
		}
	}
	if strings.Contains(FragmentBlock("note", "src", "id2", "body"), EditFragmentGuidance) {
		t.Error("a note block must not carry the edit guidance")
	}
	if !strings.Contains(ContextLegend, `"`+EditFragmentKind+`"`) {
		t.Error("ContextLegend does not describe edit fragments")
	}
}

// The brief transcript labels every turn by role, marks the bookmarked
// ones, and ends by asking for the one tool call.
func TestChatBriefTranscript(t *testing.T) {
	got := ChatBriefTranscript([]ChatBriefLine{
		{Role: "user", Text: " what about the lifts? "},
		{Role: "assistant", Text: "The contract lapsed.", Bookmarked: true},
	})
	for _, want := range []string{
		"user:\nwhat about the lifts?\n",
		"assistant " + BookmarkedMarker + ":\nThe contract lapsed.\n",
		"Call " + ProposeBriefToolName + " once.",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("transcript missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "user "+BookmarkedMarker) {
		t.Errorf("unbookmarked turn marked:\n%s", got)
	}
	if !strings.Contains(ChatBriefSystem, ProductBrief) || !strings.Contains(ChatBriefSystem, ProposeBriefToolName) {
		t.Error("brief system prompt must carry the product brief and name its tool")
	}
}
