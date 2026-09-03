package llmcontext_test

import (
	"context"
	"strings"
	"testing"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// Summaries mode renders an annotated fragment as its row and an unannotated
// one as a stub of its opening — never a full body; full mode is unchanged.
func TestHydrateDeltaSummaries(t *testing.T) {
	app := testutil.NewApp(t)
	annotated := addFragment(t, app, "email", "THE FULL EMAIL BODY that must not appear")
	testutil.NewRecord(t, app, "fragment_annotation", map[string]any{
		"fragment_id": annotated.Id,
		"title":       "Lift quote",
		"summary":     "A quote for the lift arrived.",
		"things":      []map[string]string{{"name": "Acme", "kind": "organisation"}},
	})
	raw := addFragment(t, app, "note", strings.Repeat("opening ", 60))

	added := llmcontext.PinnedIDs{FragmentIDs: []string{annotated.Id, raw.Id}}
	text, err := llmcontext.HydrateDeltaToText(context.Background(), app, added, llmcontext.PinnedIDs{}, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{prompts.SummariesAddedNotice, "Lift quote", "(ID: " + annotated.Id + ")", "Acme", "not yet annotated", "(ID: " + raw.Id + ";", "opening opening"} {
		if !strings.Contains(text, want) {
			t.Errorf("summaries hydration lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "THE FULL EMAIL BODY") || strings.Contains(text, "--- email") {
		t.Errorf("summaries hydration leaked a full body:\n%s", text)
	}
	if strings.Contains(text, strings.Repeat("opening ", 40)) {
		t.Errorf("stub was not cut to the snippet length:\n%s", text)
	}

	full, err := llmcontext.HydrateDeltaToText(context.Background(), app, added, llmcontext.PinnedIDs{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(full, prompts.FragmentBlock("email", "", annotated.Id, "THE FULL EMAIL BODY that must not appear")) {
		t.Errorf("full mode no longer renders the body:\n%s", full)
	}
}

// A pinned fragment renders in full under summaries mode while the rest of the
// scope renders as rows — once each.
func TestHydrateDeltaSummariesKeepsPinsFull(t *testing.T) {
	app := testutil.NewApp(t)
	pinned := addFragment(t, app, "email", "THE PINNED BODY")
	rowed := addFragment(t, app, "note", "THE ROWED BODY")
	testutil.NewRecord(t, app, "fragment_annotation", map[string]any{
		"fragment_id": rowed.Id, "title": "Rowed note", "summary": "Just a row.",
	})

	added := llmcontext.PinnedIDs{FragmentIDs: []string{pinned.Id, rowed.Id}, ExpandedIDs: []string{pinned.Id}}
	text, err := llmcontext.HydrateDeltaToText(context.Background(), app, added, llmcontext.PinnedIDs{}, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{prompts.AddedNotice, prompts.FragmentBlock("email", "", pinned.Id, "THE PINNED BODY"), prompts.SummariesAddedNotice, "Rowed note"} {
		if !strings.Contains(text, want) {
			t.Errorf("mixed hydration lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "THE ROWED BODY") {
		t.Errorf("rowed fragment leaked its body:\n%s", text)
	}
	if strings.Count(text, "(ID: "+pinned.Id) != 1 {
		t.Errorf("pinned fragment rendered more than once:\n%s", text)
	}
	if strings.Index(text, prompts.AddedNotice) > strings.Index(text, prompts.SummariesAddedNotice) {
		t.Errorf("full blocks should precede the rows:\n%s", text)
	}

	// Full mode ignores the expansion: everything is a body, once.
	text, err = llmcontext.HydrateDeltaToText(context.Background(), app, added, llmcontext.PinnedIDs{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(text, "(ID: "+pinned.Id) != 1 || !strings.Contains(text, "THE ROWED BODY") {
		t.Errorf("full mode rendering off:\n%s", text)
	}
}
