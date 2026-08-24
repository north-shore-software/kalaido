package handlers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// newRefinement opens an empty projection refinement conversation to seed into.
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

// The point of seeding: text that came from somewhere else is committable
// without a model call, because the commit path cannot tell it apart from a
// draft the assistant produced.
func TestSeededDraftIsCommittable(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)

	persist(t, app, ref, seedDraftMessage("SEEDED CONTENT"))

	draft, _, _, _, err := ExtractDraftedSnapshotAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if draft != "SEEDED CONTENT" {
		t.Errorf("draft = %q, want %q", draft, "SEEDED CONTENT")
	}
}

// A seed is a starting point, not a floor: once the user refines it, their
// version is what gets committed.
func TestARealDraftSupersedesTheSeed(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)

	persist(t, app, ref, seedDraftMessage("SEEDED CONTENT"))
	// Messages are ordered by `created`, which has millisecond granularity, and
	// two back-to-back writes land in the same millisecond — the tie then breaks
	// arbitrarily. Real drafts are always separated by a model call, so this only
	// bites here; wait out the tie rather than assert on luck.
	time.Sleep(2 * time.Millisecond)
	persist(t, app, ref, seedDraftMessage("REFINED CONTENT"))

	draft, _, _, _, err := ExtractDraftedSnapshotAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if draft != "REFINED CONTENT" {
		t.Errorf("draft = %q, want the later one", draft)
	}
}

// Committing straight after seeding — graduate, then approve as-is — must still
// produce a snapshot with an honest receipt. Without the resolved pinned_ids the
// commit would record that nothing went in, leaving the new projection stale the
// instant it was created.
func TestSeededContextCarriesItsResolvedIDs(t *testing.T) {
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
	persist(t, app, ref, seedDraftMessage("SEEDED CONTENT"))

	_, pinned, gotSpec, _, err := ExtractDraftedSnapshotAndSpec(app, ref)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if len(pinned.FragmentIDs) != 1 || pinned.FragmentIDs[0] != fragment.Id {
		t.Errorf("resolved context = %v, want [%s]", pinned.FragmentIDs, fragment.Id)
	}
	if len(gotSpec.FragmentIDs) != 1 || gotSpec.FragmentIDs[0] != fragment.Id {
		t.Errorf("context spec = %v, want the seeded spec", gotSpec.FragmentIDs)
	}
}
