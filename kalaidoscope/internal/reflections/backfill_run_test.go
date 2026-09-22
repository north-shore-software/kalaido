// UNREVIEWED
package reflections_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
)

type backfillScript struct {
	mu    sync.Mutex
	calls [][]llm.Message
	reply func(msgs []llm.Message) (string, error)
}

func (s *backfillScript) install(t *testing.T) {
	t.Helper()
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return backfillScriptProvider{s}
	})
	t.Cleanup(func() {
		llm.SetProviderFactory(nil)
	})
}

type backfillScriptProvider struct{ s *backfillScript }

func (p backfillScriptProvider) ContextWindow() int { return 256_000 }

func (p backfillScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	p.s.mu.Lock()
	p.s.calls = append(p.s.calls, msgs)
	p.s.mu.Unlock()
	reply, err := p.s.reply(msgs)
	if err != nil {
		return nil, err
	}
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: reply}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

// The runner generates exactly the pending set as approved
// snapshots filed under each window's key, and a second run has nothing to do.
func TestGeneratePendingWindowsFillsTheSeries(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "notes"})
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": "LENS",
	})
	eff := time.Now().Add(-16 * day).UTC()
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	var mu sync.Mutex
	var order []string
	script := &backfillScript{reply: func(msgs []llm.Message) (string, error) {
		if len(msgs) != 1 {
			return "", fmt.Errorf("unexpected transcript length %d", len(msgs))
		}
		mu.Lock()
		defer mu.Unlock()
		order = append(order, msgs[0].Content)
		return fmt.Sprintf("OUT %d", len(order)), nil
	}}
	script.install(t)

	reflections.GeneratePendingWindows(context.Background(), app, refl.Id)

	grid := reflections.CurrentGridWindows(refl, time.Now())
	if len(grid) != 2 {
		t.Fatalf("grid = %d, want 2", len(grid))
	}
	for i, w := range grid {
		filter, params := engine.ApprovedSnapshotFilter(reflections.Strategy{}, refl.Id, &w)
		snaps, _ := app.FindRecordsByFilter("reflection_snapshot", filter, "", 0, 0, params)
		if len(snaps) != 1 {
			t.Fatalf("window %d: %d approved snapshots, want 1", i, len(snaps))
		}
	}
	if len(order) != 2 {
		t.Fatalf("model calls = %d, want one per window", len(order))
	}
	for i, w := range grid {
		start, _ := engine.WindowBounds(&w)
		want := start.Time().Format("2006-01-02 15:04:05")
		if !strings.Contains(order[0], want) && !strings.Contains(order[1], want) {
			t.Errorf("window %d: no call carried its bounds (%q)", i, want)
		}
	}
	if got := reflections.PendingWindows(app, refl, time.Now()); len(got) != 0 {
		t.Errorf("pending after run = %d, want 0", len(got))
	}

	reflections.GeneratePendingWindows(context.Background(), app, refl.Id)
	if len(order) != 2 {
		t.Errorf("second run made %d more calls, want none", len(order)-2)
	}
}

// Without a lens (nothing committed yet) the runner stops without persisting.
func TestGeneratePendingWindowsWaitsForLens(t *testing.T) {
	app := testutil.NewApp(t)
	eff := time.Now().Add(-16 * 24 * time.Hour).UTC()
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": engine.EntityActive,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	reflections.GeneratePendingWindows(context.Background(), app, refl.Id)
	snaps, _ := app.FindRecordsByFilter("reflection_snapshot", "reflection_id = {:id}", "", 0, 0, map[string]any{"id": refl.Id})
	if len(snaps) != 0 {
		t.Fatalf("persisted %d snapshots without a lens", len(snaps))
	}
}

// Windows generate in parallel, as far as the LLM queue allows: with two
// slots, two windows' model calls are in flight at the same time.
func TestGenerateWindowsRunsInParallel(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "notes"})
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": "LENS",
	})
	eff := time.Now().Add(-16 * day).UTC()
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	sched := queue.New(queue.Config{MaxConcurrent: 2, IdleAfter: time.Minute})
	app.Store().Set(usage.SchedulerStoreKey, sched)

	var mu sync.Mutex
	inFlight := 0
	both := make(chan struct{})
	script := &backfillScript{reply: func(msgs []llm.Message) (string, error) {
		mu.Lock()
		inFlight++
		if inFlight == 2 {
			close(both)
		}
		mu.Unlock()
		select {
		case <-both:
			return "OUT", nil
		case <-time.After(5 * time.Second):
			return "", fmt.Errorf("second window never started: generation is serial")
		}
	}}
	script.install(t)

	results := engine.GenerateWindows(context.Background(), app, refl.Id, engine.StatusApproved, reflections.Strategy{}, reflections.CurrentGridWindows(refl, time.Now()))
	if len(results) != 2 {
		t.Fatalf("results = %d, want 2", len(results))
	}
	for i, r := range results {
		if r.Err != nil {
			t.Errorf("window %d: %v", i, r.Err)
		}
	}
}
