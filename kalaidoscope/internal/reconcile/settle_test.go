package reconcile

import (
	"context"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// echoProvider answers every call with the same text.
type echoProvider struct{ text string }

func (echoProvider) ContextWindow() int { return 256_000 }

func (p echoProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.text}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

// A wave regeneration that reproduces the approved output is not a review
// stop: the approved snapshot records the new context in place, no row is
// added, and — because its id did not move — nothing downstream goes stale.
func TestWaveNoChangeSettlesInPlaceWithoutStalingDependents(t *testing.T) {
	app := testutil.NewApp(t)
	g := buildChain(t, app)

	// The fixture's approved output is "old output"; the model reproduces it.
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return echoProvider{text: "old output"}
	})
	t.Cleanup(func() {
		llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
			return fakeProvider{}
		})
	})

	before := countAllSnapshots(t, app)
	if err := runWave(context.Background(), app); err != nil {
		t.Fatalf("wave: %v", err)
	}
	if after := countAllSnapshots(t, app); after != before {
		t.Errorf("wave grew snapshots %d -> %d, want unchanged (settled in place)", before, after)
	}

	rSnaps := snapshotsFor(t, app, "reflection_snapshot", "reflection_id", g.refl.Id)
	if len(rSnaps) != 1 || rSnaps[0].Id != g.rSnap0.Id {
		t.Fatalf("reflection snapshots = %d, want the original approved row only", len(rSnaps))
	}
	if got := resolvedContext(t, rSnaps[0]).FragmentIDs; len(got) != 2 {
		t.Errorf("settled reflection snapshot consumed %v, want both fragments", got)
	}
	if rSnaps[0].GetString("status") != engine.StatusApproved {
		t.Errorf("settled snapshot status = %q, want approved", rSnaps[0].GetString("status"))
	}

	// P1 and P2 consumed rSnap0 / p1Snap0, whose ids did not move: nothing
	// to regenerate, and the whole chain reads as up to date.
	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(context.Background())
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	for _, s := range statuses {
		if s.UpToDateSnapshotID == "" {
			t.Errorf("%s %s not up to date after a no-change wave: %+v", s.Type, s.ID, s)
		}
	}
}
