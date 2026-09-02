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
