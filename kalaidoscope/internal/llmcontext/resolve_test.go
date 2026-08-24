package llmcontext_test

import (
	"context"
	"sort"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func sortedCopy(ids []string) []string {
	out := append([]string(nil), ids...)
	sort.Strings(out)
	return out
}

func addFragment(t *testing.T, app core.App, fragType, content string) *core.Record {
	t.Helper()
	return testutil.NewRecord(t, app, "fragment", map[string]any{
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
	app := testutil.NewApp(t)

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
	app := testutil.NewApp(t)

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
