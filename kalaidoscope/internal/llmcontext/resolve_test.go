package llmcontext_test

import (
	"context"
	"sort"
	"testing"
	"time"

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

	pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, spec, nil)
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

// A window restricts resolution to fragments whose event date (source_time)
// falls inside it, half-open. A fragment that arrived without a source_time is
// placed by its import time instead, so it belongs to the window covering
// "now" rather than to none.
func TestResolveWindowFiltersByEventDate(t *testing.T) {
	app := testutil.NewApp(t)

	at := func(s string) types.DateTime {
		d, err := types.ParseDateTime(s)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	inside := testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "inside", "source_time": at("2026-08-10T12:00:00Z"),
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "before", "source_time": at("2026-07-30T12:00:00Z"),
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "at the end (excluded)", "source_time": at("2026-08-15T00:00:00Z"),
	})
	atStart := testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "at the start (included)", "source_time": at("2026-08-08T00:00:00Z"),
	})
	undated := addFragment(t, app, "note", "no source_time; created now")

	win := &api.Window{Start: "2026-08-08T00:00:00Z", End: "2026-08-15T00:00:00Z"}

	t.Run("whole scope", func(t *testing.T) {
		pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{WholeScope: true}, win)
		if err != nil {
			t.Fatal(err)
		}
		assertIDs(t, sortedCopy(pinned.FragmentIDs), sorted(inside.Id, atStart.Id))
	})

	t.Run("criteria", func(t *testing.T) {
		pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{FragmentTypes: []string{"note"}}, win)
		if err != nil {
			t.Fatal(err)
		}
		assertIDs(t, sortedCopy(pinned.FragmentIDs), sorted(inside.Id, atStart.Id))
	})

	t.Run("undated fragments fall back to import time", func(t *testing.T) {
		now := &api.Window{
			Start: types.NowDateTime().Time().Add(-time.Hour).UTC().Format(time.RFC3339),
			End:   types.NowDateTime().Time().Add(time.Hour).UTC().Format(time.RFC3339),
		}
		pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{WholeScope: true}, now)
		if err != nil {
			t.Fatal(err)
		}
		assertIDs(t, sortedCopy(pinned.FragmentIDs), sorted(undated.Id))
	})

	t.Run("nil window is unrestricted", func(t *testing.T) {
		pinned, err := llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{WholeScope: true}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(pinned.FragmentIDs) != 5 {
			t.Fatalf("got %d fragments, want all 5", len(pinned.FragmentIDs))
		}
	})
}

// A colour in the spec contributes its members: every link except a
// manual_negative, which is an exclusion rather than a membership.
func TestResolveColourSkipsExclusions(t *testing.T) {
	app := testutil.NewApp(t)
	pinned := addFragment(t, app, "note", "pinned")
	judged := addFragment(t, app, "note", "judged")
	excluded := addFragment(t, app, "note", "excluded")
	addFragment(t, app, "note", "unrelated")
	colour := testutil.NewRecord(t, app, "colour", map[string]any{"name": "c"})
	for fid, match := range map[string]string{pinned.Id: "manual_positive", judged.Id: "prompt", excluded.Id: "manual_negative"} {
		testutil.NewRecord(t, app, "colour_fragment", map[string]any{"colour_id": colour.Id, "fragment_id": fid, "match_type": match})
	}
	got := resolveFragmentIDs(t, app, api.ContextSpec{ColourIDs: []string{colour.Id}})
	assertIDs(t, got, sorted(pinned.Id, judged.Id))
}

// Under whole scope the fragment-level pins add nothing to the scope but are
// recorded as ExpandedIDs — what renders in full under summaries. A pin that
// the window excludes is not expanded either; without whole scope the pins
// are both the scope and the expansion.
func TestResolveWholeScopeExpandsPins(t *testing.T) {
	app := testutil.NewApp(t)
	pinned := addFragment(t, app, "note", "pinned")
	viaColour := addFragment(t, app, "note", "via colour")
	other := addFragment(t, app, "note", "other")
	colour := testutil.NewRecord(t, app, "colour", map[string]any{"name": "c"})
	testutil.NewRecord(t, app, "colour_fragment", map[string]any{"colour_id": colour.Id, "fragment_id": viaColour.Id, "match_type": "prompt"})

	spec := api.ContextSpec{WholeScope: true, Summaries: true, FragmentIDs: []string{pinned.Id}, ColourIDs: []string{colour.Id}}
	got, err := llmcontext.ResolveSpecToIDs(context.Background(), app, spec, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertIDs(t, sortedCopy(got.FragmentIDs), sorted(pinned.Id, viaColour.Id, other.Id))
	assertIDs(t, sortedCopy(got.ExpandedIDs), sorted(pinned.Id, viaColour.Id))

	// Window in the far past: nothing in scope, so nothing expanded.
	win := &api.Window{Start: "2000-01-01 00:00:00.000Z", End: "2000-02-01 00:00:00.000Z"}
	got, err = llmcontext.ResolveSpecToIDs(context.Background(), app, spec, win)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.FragmentIDs) != 0 || len(got.ExpandedIDs) != 0 {
		t.Errorf("windowed resolution = %+v, want empty", got)
	}

	got, err = llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{FragmentIDs: []string{pinned.Id}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertIDs(t, got.FragmentIDs, []string{pinned.Id})
	assertIDs(t, got.ExpandedIDs, []string{pinned.Id})

	got, err = llmcontext.ResolveSpecToIDs(context.Background(), app, api.ContextSpec{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsEmpty() || len(got.ExpandedIDs) != 0 {
		t.Errorf("empty spec resolved to %+v", got)
	}
}

// The diff is scope only: pinning a fragment already in scope changes nothing.
func TestDiffPinnedIDsIsScopeOnly(t *testing.T) {
	old := llmcontext.PinnedIDs{FragmentIDs: []string{"a", "b"}}
	new := llmcontext.PinnedIDs{FragmentIDs: []string{"a", "b", "c"}, ExpandedIDs: []string{"b"}}
	added, removed := llmcontext.DiffPinnedIDs(old, new)
	assertIDs(t, added.FragmentIDs, []string{"c"})
	if !removed.IsEmpty() || len(added.ExpandedIDs) != 0 {
		t.Errorf("added/removed = %+v / %+v", added, removed)
	}
	added, removed = llmcontext.DiffPinnedIDs(new, old)
	assertIDs(t, removed.FragmentIDs, []string{"c"})
	if !added.IsEmpty() {
		t.Errorf("added = %+v, want nothing", added)
	}
}
