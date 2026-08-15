package status_test

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"

	_ "github.com/north-shore-software/kalaido/kalaidoscope/migrations"
)

// newTestApp boots a throwaway PocketBase against a temp data dir and applies
// the schema migration, so tests run against the real collections.
func newTestApp(t *testing.T) core.App {
	t.Helper()

	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:  t.TempDir(),
		HideStartBanner: true,
	})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })

	if err := app.RunAppMigrations(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return app
}

func newRecord(t *testing.T, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()

	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find collection %q: %v", collection, err)
	}
	rec := core.NewRecord(col)
	for k, v := range values {
		rec.Set(k, v)
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return rec
}

func addFragment(t *testing.T, app core.App, content string) *core.Record {
	t.Helper()
	return newRecord(t, app, "fragment", map[string]any{
		"type":    "note",
		"content": content,
	})
}

// approveSnapshot writes an approved snapshot for a projection, recording
// exactly what it consumed as its resolved context.
func approveSnapshot(t *testing.T, app core.App, projectionID string, seq int, pinned llmcontext.PinnedIDs) *core.Record {
	t.Helper()
	return newRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            projectionID,
		"status":                   "approved",
		"approval_sequence_number": seq,
		"resolved_context":         pbutil.JSONObject(pinned),
		"output":                   pbutil.JSONString("out"),
	})
}

func evaluate(t *testing.T, app core.App) map[string]api.EntityStatus {
	t.Helper()

	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(context.Background())
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	byID := make(map[string]api.EntityStatus, len(statuses))
	for _, s := range statuses {
		byID[s.ID] = s
	}
	return byID
}

// pendingSnapshot writes an unapproved candidate, recording the context it was
// generated against.
func pendingSnapshot(t *testing.T, app core.App, projectionID string, pinned llmcontext.PinnedIDs) *core.Record {
	t.Helper()
	return newRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":    projectionID,
		"status":           "pending",
		"resolved_context": pbutil.JSONObject(pinned),
		"output":           pbutil.JSONString("out"),
	})
}

// Approval promotes a candidate exactly as generated — its resolved context is
// frozen, by design, as the reproducibility receipt. So a candidate generated
// against an upstream that has since published is stale the moment it lands,
// and approving it settles nothing. This is why candidate generation refuses to
// run while an upstream is still awaiting approval.
func TestApprovingACandidateGeneratedAgainstOldContext(t *testing.T) {
	app := newTestApp(t)

	upstream := newRecord(t, app, "projection", map[string]any{
		"name":                 "upstream",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: true}),
	})
	downstream := newRecord(t, app, "projection", map[string]any{
		"name": "downstream",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{
			SourceProjectionIDs: []string{upstream.Id},
		}),
	})

	f1 := addFragment(t, app, "first")
	up1 := approveSnapshot(t, app, upstream.Id, 1, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id},
	})
	approveSnapshot(t, app, downstream.Id, 1, llmcontext.PinnedIDs{
		SnapshotIDs: []string{up1.Id},
	})

	// The candidate is generated here, while upstream's live output is still up1.
	candidate := pendingSnapshot(t, app, downstream.Id, llmcontext.PinnedIDs{
		SnapshotIDs: []string{up1.Id},
	})

	// Upstream publishes while the candidate sits in review.
	f2 := addFragment(t, app, "second")
	approveSnapshot(t, app, upstream.Id, 2, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id, f2.Id},
	})

	if err := engine.ApproveSnapshot(
		context.Background(), app, engine.ProjectionStrategy{}, candidate.Id,
	); err != nil {
		t.Fatalf("approve: %v", err)
	}

	got := evaluate(t, app)[downstream.Id]
	if got.UpToDateSnapshotID != "" {
		t.Error("approving a candidate built on superseded upstream output must not settle the projection")
	}
	if len(got.StaleDependencies) != 1 || got.StaleDependencies[0] != upstream.Id {
		t.Errorf("staleDependencies = %v, want [%s] — it still has to consume the newer output",
			got.StaleDependencies, upstream.Id)
	}
	// Nothing is pending upstream any more, so this is work that can be done now.
	if len(got.BlockedBy) != 0 {
		t.Errorf("blockedBy = %v, want empty", got.BlockedBy)
	}
}

// The same freeze applies to fragments, with no dependency graph involved: a
// fragment that lands while a candidate is in review is not in that candidate's
// resolved context, so approving it leaves the projection needing another pass.
// Nothing can prevent this one — the world moves while you review — so the UI
// has to report it rather than swallow it.
func TestApprovingACandidateAfterAFragmentLands(t *testing.T) {
	app := newTestApp(t)

	proj := newRecord(t, app, "projection", map[string]any{
		"name":                 "notes",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: true}),
	})

	f1 := addFragment(t, app, "first")
	approveSnapshot(t, app, proj.Id, 1, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id},
	})

	f2 := addFragment(t, app, "second")
	candidate := pendingSnapshot(t, app, proj.Id, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id, f2.Id},
	})

	// A third fragment arrives while the candidate is being reviewed.
	f3 := addFragment(t, app, "third")

	if err := engine.ApproveSnapshot(
		context.Background(), app, engine.ProjectionStrategy{}, candidate.Id,
	); err != nil {
		t.Fatalf("approve: %v", err)
	}

	got := evaluate(t, app)[proj.Id]
	if len(got.NewFragmentIDs) != 1 || got.NewFragmentIDs[0] != f3.Id {
		t.Errorf("newFragmentIds = %v, want [%s]", got.NewFragmentIDs, f3.Id)
	}
	if got.UpToDateSnapshotID != "" {
		t.Error("a fragment that arrived after generation must still count as new")
	}
}

// A downstream projection distinguishes two situations that used to be merged
// into StaleDependencies: its upstream has published something new (stale —
// regenerate now) versus its upstream is not itself up to date (blocked — wait).
func TestEvaluateAllSeparatesStaleFromBlocked(t *testing.T) {
	app := newTestApp(t)

	upstream := newRecord(t, app, "projection", map[string]any{
		"name":                 "upstream",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: true}),
	})
	downstream := newRecord(t, app, "projection", map[string]any{
		"name": "downstream",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{
			SourceProjectionIDs: []string{upstream.Id},
		}),
	})

	f1 := addFragment(t, app, "first")
	up1 := approveSnapshot(t, app, upstream.Id, 1, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id},
	})
	approveSnapshot(t, app, downstream.Id, 1, llmcontext.PinnedIDs{
		SnapshotIDs: []string{up1.Id},
	})

	t.Run("baseline: both fresh", func(t *testing.T) {
		got := evaluate(t, app)
		if s := got[downstream.Id]; s.UpToDateSnapshotID == "" {
			t.Errorf("downstream should be up to date, got %+v", s)
		}
		if s := got[upstream.Id]; s.UpToDateSnapshotID == "" {
			t.Errorf("upstream should be up to date, got %+v", s)
		}
	})

	// A new fragment makes upstream stale. Downstream is now blocked: upstream
	// has not published anything new yet, so there is nothing to regenerate
	// against.
	f2 := addFragment(t, app, "second")

	t.Run("upstream stale: downstream is blocked, not stale", func(t *testing.T) {
		got := evaluate(t, app)

		up := got[upstream.Id]
		if len(up.NewFragmentIDs) != 1 || up.NewFragmentIDs[0] != f2.Id {
			t.Errorf("upstream newFragmentIds = %v, want [%s]", up.NewFragmentIDs, f2.Id)
		}

		down := got[downstream.Id]
		if len(down.BlockedBy) != 1 || down.BlockedBy[0] != upstream.Id {
			t.Errorf("downstream blockedBy = %v, want [%s]", down.BlockedBy, upstream.Id)
		}
		if len(down.StaleDependencies) != 0 {
			t.Errorf("downstream staleDependencies = %v, want empty", down.StaleDependencies)
		}
		if down.UpToDateSnapshotID != "" {
			t.Error("blocked downstream must not report as up to date")
		}
	})

	// Approving upstream unblocks downstream: it is now merely out of date with
	// respect to upstream's new output, which it can consume by regenerating.
	// This is the case that used to keep reading as "blocked upstream".
	approveSnapshot(t, app, upstream.Id, 2, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id, f2.Id},
	})

	t.Run("upstream approved: downstream is stale, not blocked", func(t *testing.T) {
		got := evaluate(t, app)

		if up := got[upstream.Id]; up.UpToDateSnapshotID == "" {
			t.Errorf("upstream should be up to date again, got %+v", up)
		}

		down := got[downstream.Id]
		if len(down.StaleDependencies) != 1 || down.StaleDependencies[0] != upstream.Id {
			t.Errorf("downstream staleDependencies = %v, want [%s]", down.StaleDependencies, upstream.Id)
		}
		if len(down.BlockedBy) != 0 {
			t.Errorf("downstream blockedBy = %v, want empty", down.BlockedBy)
		}
	})
}
