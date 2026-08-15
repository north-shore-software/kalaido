package llmcontext_test

import (
	"context"
	"sort"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

func sortedCopy(ids []string) []string {
	out := append([]string(nil), ids...)
	sort.Strings(out)
	return out
}

func addFragment(t *testing.T, app core.App, fragType, content string) *core.Record {
	t.Helper()
	return pbtest.NewRecord(t, app, "fragment", map[string]any{
		"type":    fragType,
		"content": content,
	})
}

func resolveFragmentIDs(t *testing.T, app core.App, spec api.ContextSpec) []string {
	t.Helper()

	pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, spec)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	ids := append([]string(nil), pinned.FragmentIDs...)
	sort.Strings(ids)
	return ids
}

func sorted(ids ...string) []string {
	sort.Strings(ids)
	return ids
}

func assertIDs(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("fragment ids = %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("fragment ids = %v, want %v", got, want)
		}
	}
}

// Explicit Fragments (spec/model.md "Context Spec"): a spec may pin individual
// fragments by id, and they come back whatever their type or colours.
func TestResolveExplicitFragments(t *testing.T) {
	app := pbtest.NewApp(t)

	note := addFragment(t, app, "note", "a note")
	email := addFragment(t, app, "email", "an email")
	addFragment(t, app, "sms", "unrelated")

	t.Run("a pin resolves to exactly that fragment", func(t *testing.T) {
		got := resolveFragmentIDs(t, app, api.ContextSpec{
			FragmentIDs: []string{note.Id},
		})
		assertIDs(t, got, sorted(note.Id))
	})

	// The pinned set supplements the rules rather than narrowing them: the
	// result is the union, so pinning an email alongside "all notes" yields
	// both, not their (empty) intersection.
	t.Run("pins union with the rule-based criteria", func(t *testing.T) {
		got := resolveFragmentIDs(t, app, api.ContextSpec{
			FragmentIDs:   []string{email.Id},
			FragmentTypes: []string{"note"},
		})
		assertIDs(t, got, sorted(note.Id, email.Id))
	})

	// A fragment matched by both a pin and a rule is one input, not two.
	t.Run("a pin that also matches a rule appears once", func(t *testing.T) {
		got := resolveFragmentIDs(t, app, api.ContextSpec{
			FragmentIDs:   []string{note.Id},
			FragmentTypes: []string{"note"},
		})
		assertIDs(t, got, sorted(note.Id))
	})

	// WholeScope suppresses fragment-level criteria, pins included — everything
	// is in scope already, so there is nothing for a pin to add.
	t.Run("whole scope subsumes pins", func(t *testing.T) {
		got := resolveFragmentIDs(t, app, api.ContextSpec{
			WholeScope:  true,
			FragmentIDs: []string{note.Id},
		})
		if len(got) != 3 {
			t.Fatalf("fragment ids = %v, want all three fragments", got)
		}
	})
}

// Deletion removes a fragment from all future context resolution whether it was
// pinned or matched by rule — a pin is not a way to hold on to deleted material.
func TestResolveExplicitFragmentsSkipsDeleted(t *testing.T) {
	app := pbtest.NewApp(t)

	kept := addFragment(t, app, "note", "kept")
	gone := addFragment(t, app, "note", "deleted")

	gone.Set("deleted_at", types.NowDateTime())
	if err := app.Save(gone); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	got := resolveFragmentIDs(t, app, api.ContextSpec{
		FragmentIDs: []string{kept.Id, gone.Id},
	})
	assertIDs(t, got, sorted(kept.Id))
}

// A focus splits how a context is presented, never what it contains.
func TestResolveFocus(t *testing.T) {
	app := pbtest.NewApp(t)

	subject := addFragment(t, app, "chat", "the thing being worked on")
	note := addFragment(t, app, "note", "supporting note")

	spec := api.ContextSpec{
		FragmentTypes: []string{"note"},
		Focus:         &api.ContextSpec{FragmentIDs: []string{subject.Id}},
	}

	pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, spec)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	t.Run("the focus is separated from the background", func(t *testing.T) {
		assertIDs(t, sortedCopy(pinned.FocusOrEmpty().FragmentIDs), sorted(subject.Id))
		assertIDs(t, sortedCopy(pinned.Background().FragmentIDs), sorted(note.Id))
	})

	t.Run("the whole context is the union", func(t *testing.T) {
		assertIDs(t, sortedCopy(pinned.All().FragmentIDs), sorted(subject.Id, note.Id))
	})

	// Without this, an item named by both halves would be sent to the model
	// twice — once as the subject, once as background.
	t.Run("an item in both halves belongs to the focus only", func(t *testing.T) {
		both, err := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{
			FragmentTypes: []string{"note"},
			Focus:         &api.ContextSpec{FragmentIDs: []string{note.Id}},
		})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		assertIDs(t, sortedCopy(both.FocusOrEmpty().FragmentIDs), sorted(note.Id))
		assertIDs(t, sortedCopy(both.Background().FragmentIDs), nil)
		assertIDs(t, sortedCopy(both.All().FragmentIDs), sorted(note.Id))
	})

	// The nested spec's own Focus is ignored, so a spec can't recurse.
	t.Run("a focus within a focus is ignored", func(t *testing.T) {
		nested, err := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{
			Focus: &api.ContextSpec{
				FragmentIDs: []string{subject.Id},
				Focus:       &api.ContextSpec{FragmentIDs: []string{note.Id}},
			},
		})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		assertIDs(t, sortedCopy(nested.All().FragmentIDs), sorted(subject.Id))
	})
}

// The safety property the whole design rests on: focus is invisible to anything
// that asks what the context *contains*, so staleness cannot see it.
func TestFocusDoesNotAffectDiff(t *testing.T) {
	flat := llmcontext.PinnedIDs{FragmentIDs: []string{"a", "b"}}
	split := llmcontext.PinnedIDs{
		FragmentIDs: []string{"b"},
		Focus:       &llmcontext.PinnedIDs{FragmentIDs: []string{"a"}},
	}

	if d := flat.Diff(split); len(d.FragmentIDs) != 0 {
		t.Errorf("flat.Diff(split) = %v, want empty", d.FragmentIDs)
	}
	if d := split.Diff(flat); len(d.FragmentIDs) != 0 {
		t.Errorf("split.Diff(flat) = %v, want empty", d.FragmentIDs)
	}

	// A genuinely new document still reads as new when it arrives as the focus.
	grown := llmcontext.PinnedIDs{
		FragmentIDs: []string{"a", "b"},
		Focus:       &llmcontext.PinnedIDs{FragmentIDs: []string{"c"}},
	}
	d := grown.Diff(flat)
	if len(d.FragmentIDs) != 1 || d.FragmentIDs[0] != "c" {
		t.Errorf("grown.Diff(flat) = %v, want [c]", d.FragmentIDs)
	}
}

// The split has to reach the prompt, or it means nothing.
func TestHydrateSeparatesFocusFromBackground(t *testing.T) {
	app := pbtest.NewApp(t)

	subject := addFragment(t, app, "chat", "SUBJECT-TEXT")
	background := addFragment(t, app, "note", "BACKGROUND-TEXT")

	pinned := llmcontext.PinnedIDs{
		FragmentIDs: []string{background.Id},
		Focus:       &llmcontext.PinnedIDs{FragmentIDs: []string{subject.Id}},
	}

	text, err := llmcontext.HydrateIDsToText(context.Background(), app, pinned)
	if err != nil {
		t.Fatalf("hydrate: %v", err)
	}

	focusAt := strings.Index(text, prompts.FocusHeading)
	backgroundAt := strings.Index(text, prompts.BackgroundHeading)
	if focusAt < 0 || backgroundAt < 0 {
		t.Fatalf("both headings must appear, got:\n%s", text)
	}
	if focusAt > backgroundAt {
		t.Error("the focus must be stated before the background")
	}

	subjectAt := strings.Index(text, "SUBJECT-TEXT")
	if subjectAt < focusAt || subjectAt > backgroundAt {
		t.Errorf("the subject's content must sit under the focus heading, got:\n%s", text)
	}
	if at := strings.Index(text, "BACKGROUND-TEXT"); at < backgroundAt {
		t.Errorf("background content must sit under the background heading, got:\n%s", text)
	}
	// It is one document or the other, never both.
	if strings.Count(text, "SUBJECT-TEXT") != 1 {
		t.Error("the focused document must not be rendered twice")
	}
}

// With no focus, hydration is exactly what it was — no headings introduced.
func TestHydrateWithoutFocusIsUnlabelled(t *testing.T) {
	app := pbtest.NewApp(t)

	f := addFragment(t, app, "note", "PLAIN-TEXT")
	text, err := llmcontext.HydrateIDsToText(context.Background(), app, llmcontext.PinnedIDs{
		FragmentIDs: []string{f.Id},
	})
	if err != nil {
		t.Fatalf("hydrate: %v", err)
	}
	if strings.Contains(text, prompts.FocusHeading) ||
		strings.Contains(text, prompts.BackgroundHeading) {
		t.Errorf("unfocused context must not be labelled, got:\n%s", text)
	}
	if !strings.Contains(text, "PLAIN-TEXT") {
		t.Errorf("content missing, got:\n%s", text)
	}
}

// Pins resolve alongside colour membership, which is the other id-based path
// into the same query.
func TestResolveExplicitFragmentsWithColours(t *testing.T) {
	app := pbtest.NewApp(t)

	pinned := addFragment(t, app, "email", "pinned")
	tagged := addFragment(t, app, "sms", "tagged")

	colour := pbtest.NewRecord(t, app, "colour", map[string]any{
		"name":     "urgent",
		"criteria": "is it urgent?",
	})
	pbtest.NewRecord(t, app, "colour_fragment", map[string]any{
		"colour_id":   colour.Id,
		"fragment_id": tagged.Id,
		"match_type":  "manual_positive",
	})

	got := resolveFragmentIDs(t, app, api.ContextSpec{
		FragmentIDs: []string{pinned.Id},
		ColourIDs:   []string{colour.Id},
	})
	assertIDs(t, got, sorted(pinned.Id, tagged.Id))
}
