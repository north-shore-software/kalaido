package reconcile_test

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func addFragment(t *testing.T, app core.App, content string) *core.Record {
	t.Helper()
	return testutil.NewRecord(t, app, "fragment", map[string]any{
		"type":    "note",
		"content": content,
	})
}

// approveSnapshot writes an approved snapshot for a projection, recording
// exactly what it consumed as its resolved context.
func approveSnapshot(t *testing.T, app core.App, projectionID string, seq int, pinned llmcontext.PinnedIDs) *core.Record {
	t.Helper()
	return testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            projectionID,
		"status":                   "approved",
		"approval_sequence_number": seq,
		"resolved_context":         pbutil.JSONObject(pinned),
		"output":                   "out",
	})
}

func evaluate(t *testing.T, app core.App) map[string]api.EntityStatus {
	t.Helper()

	statuses, err := reconcile.NewEvaluator(app, time.Now()).EvaluateAll(context.Background())
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
	return testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":    projectionID,
		"status":           "pending_review",
		"resolved_context": pbutil.JSONObject(pinned),
		"output":           "out",
	})
}

// Approval promotes a candidate exactly as generated — its resolved context is
// frozen, by design, as the reproducibility receipt. So a candidate generated
// against an upstream that has since published is stale the moment it lands,
// and approving it settles nothing. This is why candidate generation refuses to
// run while an upstream is still awaiting approval.
func TestApprovingACandidateGeneratedAgainstOldContext(t *testing.T) {
	app := testutil.NewApp(t)

	upstream := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "upstream",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}),
	})
	downstream := testutil.NewRecord(t, app, "projection", map[string]any{
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
		context.Background(), app, projections.Strategy{}, candidate.Id,
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
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "notes",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}),
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
		context.Background(), app, projections.Strategy{}, candidate.Id,
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
	app := testutil.NewApp(t)

	upstream := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "upstream",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}),
	})
	downstream := testutil.NewRecord(t, app, "projection", map[string]any{
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
		// Upstream has new fragments.
		up := got[upstream.Id]
		if len(up.NewFragmentIDs) != 1 || up.NewFragmentIDs[0] != f2.Id {
			t.Errorf("upstream newFragmentIds = %v, want [%s]", up.NewFragmentIDs, f2.Id)
		}

		// Downstream is blocked by upstream, because upstream is not fresh.
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

// A spec that pins fragments explicitly is a *static* set — unlike a colour or
// type rule it never grows as fragments arrive, so a projection built only on
// pins stays up to date no matter what else lands. It goes stale when the pinned
// set itself is edited, which is the only way it can change.
func TestExplicitlyPinnedFragmentsDoNotGoStaleOnTheirOwn(t *testing.T) {
	app := testutil.NewApp(t)

	f1 := addFragment(t, app, "pinned")

	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name": "pinned only",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{
			FragmentIDs: []string{f1.Id},
		}),
	})
	approveSnapshot(t, app, proj.Id, 1, llmcontext.PinnedIDs{
		FragmentIDs: []string{f1.Id},
	})

	// A fragment of the same type arrives. A type or whole-scope rule would pick
	// it up; a pin must not.
	f2 := addFragment(t, app, "not pinned")

	t.Run("an unpinned fragment is not new input", func(t *testing.T) {
		got := evaluate(t, app)[proj.Id]
		if len(got.NewFragmentIDs) != 0 {
			t.Errorf("newFragmentIds = %v, want empty — the pinned set is static", got.NewFragmentIDs)
		}
		if got.UpToDateSnapshotID == "" {
			t.Errorf("projection should be up to date, got %+v", got)
		}
	})

	t.Run("pinning it makes the projection stale", func(t *testing.T) {
		proj.Set("current_context_spec", pbutil.JSONObject(api.ContextSpec{
			FragmentIDs: []string{f1.Id, f2.Id},
		}))
		if err := app.Save(proj); err != nil {
			t.Fatalf("save spec: %v", err)
		}

		got := evaluate(t, app)[proj.Id]
		if len(got.NewFragmentIDs) != 1 || got.NewFragmentIDs[0] != f2.Id {
			t.Errorf("newFragmentIds = %v, want [%s]", got.NewFragmentIDs, f2.Id)
		}
	})
}

func dated(t *testing.T, app core.App, content string, at time.Time) *core.Record {
	t.Helper()
	d, _ := types.ParseDateTime(at)
	return testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": content, "occurred_at": d})
}

func statusOf(t *testing.T, app core.App, id string, now time.Time) api.EntityStatus {
	t.Helper()
	statuses, err := reconcile.NewEvaluator(app, now).EvaluateAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range statuses {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("entity %s not evaluated", id)
	return api.EntityStatus{}
}

// Staleness is per window: a fragment dated inside an already-summarized
// window flags that window only; one dated in no window flags nothing.
func TestReflectionStalenessIsPerWindow(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := time.Now().Add(-16 * day).UTC().Truncate(time.Second)
	now := time.Now()

	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": "L",
	})
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	grid := reflections.CurrentGridWindows(refl, now)
	if len(grid) != 2 {
		t.Fatalf("grid = %d, want 2", len(grid))
	}

	f1 := dated(t, app, "week one, seen", eff.Add(2*day))
	f2 := dated(t, app, "week two, seen", eff.Add(9*day))
	for i, w := range grid {
		seen := []string{f1.Id, f2.Id}[i]
		testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
			"reflection_id": refl.Id, "status": engine.StatusApproved, "approval_sequence_number": 1,
			"lens_id": lens.Id, "output": "summary",
			"window_start": w.Start, "window_end": w.End,
			"resolved_context": pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{seen}}),
		})
	}

	s := statusOf(t, app, refl.Id, now)
	if s.UpToDateSnapshotID == "" || len(s.StaleWindows) != 0 || len(s.NewFragmentIDs) != 0 || len(s.PendingWindows) != 0 {
		t.Fatalf("fresh series reads stale: %+v", s)
	}

	// Outside every window: before the schedule began, and in the open week.
	dated(t, app, "ancient", eff.Add(-30*day))
	dated(t, app, "this week, still open", now.Add(-time.Hour))
	s = statusOf(t, app, refl.Id, now)
	if len(s.StaleWindows) != 0 || len(s.NewFragmentIDs) != 0 {
		t.Fatalf("fragments outside every window flagged: %+v", s)
	}

	// Backdated into week one.
	late := dated(t, app, "late email from week one", eff.Add(3*day))
	s = statusOf(t, app, refl.Id, now)
	if len(s.StaleWindows) != 1 || s.StaleWindows[0].ID != grid[0].ID {
		t.Fatalf("stale windows = %+v, want week one only", s.StaleWindows)
	}
	if len(s.NewFragmentIDs) != 1 || s.NewFragmentIDs[0] != late.Id {
		t.Errorf("new fragments = %v, want the late one", s.NewFragmentIDs)
	}
	if s.UpToDateSnapshotID != "" {
		t.Errorf("stale reflection reports an up-to-date snapshot")
	}
}

// The plan reports a pending candidate's own currency, separately from the
// live snapshot's: which fragments it never saw, and whether the user has
// invested in it.
func TestCandidateStatusReportsOutdatedReasonAndEngagement(t *testing.T) {
	app := testutil.NewApp(t)

	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "notes",
		"current_context_spec": pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}),
	})
	f1 := addFragment(t, app, "first")
	approveSnapshot(t, app, proj.Id, 1, llmcontext.PinnedIDs{FragmentIDs: []string{f1.Id}})
	candidate := pendingSnapshot(t, app, proj.Id, llmcontext.PinnedIDs{FragmentIDs: []string{f1.Id}})

	got := evaluate(t, app)[proj.Id]
	if got.Candidate == nil || got.Candidate.ID != candidate.Id {
		t.Fatalf("candidate = %+v, want %s", got.Candidate, candidate.Id)
	}
	if got.Candidate.Outdated || got.Candidate.Reason != "" || got.Candidate.Engaged {
		t.Errorf("fresh untouched candidate reported as %+v", got.Candidate)
	}

	f2 := addFragment(t, app, "second")
	candidate.Set("edits", pbutil.JSONObject([]api.SnapshotEdit{{ID: "e1", Type: api.EditTypeManual, Status: api.EditStatusApproved}}))
	if err := app.Save(candidate); err != nil {
		t.Fatal(err)
	}

	got = evaluate(t, app)[proj.Id]
	if got.Candidate == nil || !got.Candidate.Outdated {
		t.Fatalf("candidate after a new fragment = %+v, want outdated", got.Candidate)
	}
	if got.Candidate.Reason != engine.CurrencyNewFragments {
		t.Errorf("reason = %q, want %q", got.Candidate.Reason, engine.CurrencyNewFragments)
	}
	if len(got.Candidate.NewFragmentIDs) != 1 || got.Candidate.NewFragmentIDs[0] != f2.Id {
		t.Errorf("candidate newFragmentIds = %v, want [%s]", got.Candidate.NewFragmentIDs, f2.Id)
	}
	if !got.Candidate.Engaged {
		t.Error("a hand-edited candidate must report engaged")
	}
}
