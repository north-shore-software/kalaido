package reconcile

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func init() {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return fakeProvider{}
	})
}

type fakeProvider struct{}

func (fakeProvider) ContextWindow() int { return 256_000 }

func (fakeProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: "GENERATED"}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

// chainGraph is fragment → reflection R → projection P1 → projection P2, every
// entity carrying a live approved snapshot so a new fragment makes the whole
// chain stale (never-generated drafts are deliberately outside a wave's remit).
type chainGraph struct {
	f0, f1                   *core.Record
	refl, p1, p2             *core.Record
	rSnap0, p1Snap0, p2Snap0 *core.Record
}

func newLens(t *testing.T, app core.App, spec api.ContextSpec) *core.Record {
	t.Helper()
	return testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt":       pbutil.JSONString("Summarize the sources."),
		"context_spec": pbutil.JSONObject(spec),
	})
}

func newApprovedSnapshot(t *testing.T, app core.App, col, fk, parentID, lensID string, pinned llmcontext.PinnedIDs) *core.Record {
	t.Helper()
	return testutil.NewRecord(t, app, col, map[string]any{
		fk:                         parentID,
		"lens_id":                  lensID,
		"output":                   pbutil.JSONString("old output"),
		"resolved_context":         pbutil.JSONObject(pinned),
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
	})
}

func buildChain(t *testing.T, app core.App) chainGraph {
	t.Helper()
	g := chainGraph{}

	g.f0 = testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "old fragment"})

	reflSpec := api.ContextSpec{WholeScope: true}
	reflLens := newLens(t, app, reflSpec)
	g.refl = testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "R",
		"current_context_spec": pbutil.JSONObject(reflSpec),
		"current_lens_id":      reflLens.Id,
	})
	g.rSnap0 = newApprovedSnapshot(t, app, "reflection_snapshot", "reflection_id", g.refl.Id, reflLens.Id,
		llmcontext.PinnedIDs{FragmentIDs: []string{g.f0.Id}})

	p1Spec := api.ContextSpec{SourceReflectionIDs: []string{g.refl.Id}}
	p1Lens := newLens(t, app, p1Spec)
	g.p1 = testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P1",
		"current_context_spec": pbutil.JSONObject(p1Spec),
		"current_lens_id":      p1Lens.Id,
	})
	g.p1Snap0 = newApprovedSnapshot(t, app, "projection_snapshot", "projection_id", g.p1.Id, p1Lens.Id,
		llmcontext.PinnedIDs{SnapshotIDs: []string{g.rSnap0.Id}})

	p2Spec := api.ContextSpec{SourceProjectionIDs: []string{g.p1.Id}}
	p2Lens := newLens(t, app, p2Spec)
	g.p2 = testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P2",
		"current_context_spec": pbutil.JSONObject(p2Spec),
		"current_lens_id":      p2Lens.Id,
	})
	g.p2Snap0 = newApprovedSnapshot(t, app, "projection_snapshot", "projection_id", g.p2.Id, p2Lens.Id,
		llmcontext.PinnedIDs{SnapshotIDs: []string{g.p1Snap0.Id}})

	// The new fragment that makes R stale and, transitively, blocks P1 and P2.
	g.f1 = testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "new fragment"})

	// Snapshot ordering inside speculative resolution is by `created`, which
	// has millisecond granularity; make sure wave-written rows sort after the
	// fixture rows even on a fast machine.
	time.Sleep(2 * time.Millisecond)
	return g
}

func snapshotsFor(t *testing.T, app core.App, col, fk, parentID string) []*core.Record {
	t.Helper()
	recs, err := app.FindRecordsByFilter(col, fk+" = {:id}", "-created", 0, 0, dbx.Params{"id": parentID})
	if err != nil {
		t.Fatalf("list %s: %v", col, err)
	}
	return recs
}

func resolvedContext(t *testing.T, rec *core.Record) llmcontext.PinnedIDs {
	t.Helper()
	var pinned llmcontext.PinnedIDs
	if err := rec.UnmarshalJSONField("resolved_context", &pinned); err != nil {
		t.Fatalf("resolved_context: %v", err)
	}
	return pinned
}

func countAllSnapshots(t *testing.T, app core.App) int {
	t.Helper()
	proj, err := app.FindRecordsByFilter("projection_snapshot", "1=1", "", 0, 0, nil)
	if err != nil {
		t.Fatalf("count projection snapshots: %v", err)
	}
	refl, err := app.FindRecordsByFilter("reflection_snapshot", "1=1", "", 0, 0, nil)
	if err != nil {
		t.Fatalf("count reflection snapshots: %v", err)
	}
	return len(proj) + len(refl)
}

func TestWaveSpeculativelyGeneratesWholeChain(t *testing.T) {
	app := testutil.NewApp(t)
	g := buildChain(t, app)

	runWave(app)

	// R published a fresh approved snapshot consuming both fragments.
	rSnaps := snapshotsFor(t, app, "reflection_snapshot", "reflection_id", g.refl.Id)
	if len(rSnaps) != 2 {
		t.Fatalf("reflection snapshots = %d, want 2", len(rSnaps))
	}
	rNew := rSnaps[0]
	if rNew.GetString("status") != engine.StatusApproved {
		t.Errorf("reflection wave snapshot status = %q, want approved", rNew.GetString("status"))
	}
	if got := resolvedContext(t, rNew).FragmentIDs; len(got) != 2 {
		t.Errorf("reflection wave snapshot consumed %v, want both fragments", got)
	}
	if rNew.GetString("chain_origin") != llmcontext.ChainOriginGenerateAll {
		t.Errorf("reflection chain_origin = %q", rNew.GetString("chain_origin"))
	}

	// P1 got a pending candidate consuming R's *new* snapshot.
	p1Snaps := snapshotsFor(t, app, "projection_snapshot", "projection_id", g.p1.Id)
	if len(p1Snaps) != 2 {
		t.Fatalf("p1 snapshots = %d, want 2", len(p1Snaps))
	}
	p1Cand := p1Snaps[0]
	if p1Cand.GetString("status") != engine.StatusPending {
		t.Errorf("p1 candidate status = %q, want pending", p1Cand.GetString("status"))
	}
	if got := resolvedContext(t, p1Cand).SnapshotIDs; len(got) != 1 || got[0] != rNew.Id {
		t.Errorf("p1 candidate consumed %v, want [%s]", got, rNew.Id)
	}

	// P2's candidate consumed P1's *unapproved* candidate — the speculation.
	p2Snaps := snapshotsFor(t, app, "projection_snapshot", "projection_id", g.p2.Id)
	if len(p2Snaps) != 2 {
		t.Fatalf("p2 snapshots = %d, want 2", len(p2Snaps))
	}
	p2Cand := p2Snaps[0]
	if got := resolvedContext(t, p2Cand).SnapshotIDs; len(got) != 1 || got[0] != p1Cand.Id {
		t.Errorf("p2 candidate consumed %v, want p1's pending candidate %s", got, p1Cand.Id)
	}
	if p2Cand.GetString("chain_origin") != llmcontext.ChainOriginGenerateAll {
		t.Errorf("p2 chain_origin = %q", p2Cand.GetString("chain_origin"))
	}
}

func TestRepeatWaveGeneratesNothing(t *testing.T) {
	app := testutil.NewApp(t)
	buildChain(t, app)

	runWave(app)
	before := countAllSnapshots(t, app)

	time.Sleep(2 * time.Millisecond)
	runWave(app)
	if after := countAllSnapshots(t, app); after != before {
		t.Errorf("second wave grew snapshots %d -> %d, want unchanged", before, after)
	}
}

func TestApprovingAsIsSettlesChainWithoutRegeneration(t *testing.T) {
	app := testutil.NewApp(t)
	g := buildChain(t, app)

	runWave(app)

	ctx := context.Background()
	p1Cand := snapshotsFor(t, app, "projection_snapshot", "projection_id", g.p1.Id)[0]
	p2Cand := snapshotsFor(t, app, "projection_snapshot", "projection_id", g.p2.Id)[0]
	if err := engine.ApproveSnapshot(ctx, app, engine.ProjectionStrategy{}, p1Cand.Id); err != nil {
		t.Fatalf("approve p1: %v", err)
	}
	if err := engine.ApproveSnapshot(ctx, app, engine.ProjectionStrategy{}, p2Cand.Id); err != nil {
		t.Fatalf("approve p2: %v", err)
	}

	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(ctx)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	for _, s := range statuses {
		if s.UpToDateSnapshotID == "" {
			t.Errorf("%s %s not up to date after approving the chain as-is: %+v", s.Type, s.ID, s)
		}
	}

	before := countAllSnapshots(t, app)
	time.Sleep(2 * time.Millisecond)
	runWave(app)
	if after := countAllSnapshots(t, app); after != before {
		t.Errorf("wave after settling grew snapshots %d -> %d, want unchanged", before, after)
	}
}

func TestRefiningChainCandidateRetriggersWave(t *testing.T) {
	app := testutil.NewApp(t)
	g := buildChain(t, app)

	runWave(app)

	waves := 0
	engine.RequestWave = func() { waves++ }
	defer func() { engine.RequestWave = nil }()

	ctx := context.Background()
	p1Cand := snapshotsFor(t, app, "projection_snapshot", "projection_id", g.p1.Id)[0]
	pinned := resolvedContext(t, p1Cand)
	var spec api.ContextSpec
	_ = g.p1.UnmarshalJSONField("current_context_spec", &spec)

	newSnapID, err := engine.CommitRefinement(ctx, app, engine.ProjectionStrategy{},
		g.p1.Id, p1Cand.Id, "EDITED OUTPUT", false, pinned, spec, api.WindowSpec{}, "", "projection")
	if err != nil {
		t.Fatalf("commit refinement: %v", err)
	}
	if waves != 1 {
		t.Errorf("waves after refining a pending chain candidate = %d, want 1", waves)
	}
	newSnap, err := app.FindRecordById("projection_snapshot", newSnapID)
	if err != nil {
		t.Fatalf("find committed snapshot: %v", err)
	}
	if newSnap.GetString("chain_origin") != llmcontext.ChainOriginGenerateAll {
		t.Errorf("committed snapshot chain_origin = %q, want carried forward", newSnap.GetString("chain_origin"))
	}

	// Refining an already-approved snapshot — even a chain-marked one — is an
	// ordinary edit and must not start background work.
	waves = 0
	if _, err := engine.CommitRefinement(ctx, app, engine.ProjectionStrategy{},
		g.p1.Id, newSnapID, "EDITED AGAIN", false, pinned, spec, api.WindowSpec{}, "", "projection"); err != nil {
		t.Fatalf("commit second refinement: %v", err)
	}
	if waves != 0 {
		t.Errorf("waves after refining an approved snapshot = %d, want 0", waves)
	}
}
