// Package reconcile runs speculative "generate all" waves: one request drains
// the entire stale set in dependency order, each entity generating against its
// upstreams' latest output whether or not it has been approved yet. Because
// approval promotes a snapshot record in place (same ID), approving a chain
// as-is settles every pre-generated dependent with zero further generations —
// the user click-approves through the workspace with no waits. The accepted
// cost: refining one candidate mid-chain supersedes what its dependents
// consumed, and the refinement commit re-requests a wave to regenerate them.
//
// It sits above engine (it needs the status evaluator, which imports engine),
// so engine reaches it back through the engine.RequestWave hook.
package reconcile

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
)

// Buffered by one: a wave requested while one is running coalesces into a
// single follow-up wave, which is sound because every wave re-derives the
// stale set from scratch.
var waveSignal = make(chan struct{}, 1)

var workerApp core.App

// Register wires the wave worker to the app and starts it. Also hands
// engine.RequestWave its implementation, letting refinement commits re-trigger
// a wave without engine importing this package.
func Register(app core.App) {
	workerApp = app
	engine.RequestWave = EnqueueWave
	go workerLoop()
}

// waveEnabled parks the speculative wave entirely: every snapshot generation
// must trace to an explicit user action. Temporary demo-stability switch
// (2026-08-27) — flip to true to restore "generate all" behaviour.
const waveEnabled = false

// EnqueueWave requests a speculative generation wave and returns immediately.
func EnqueueWave() {
	if !waveEnabled {
		log.Printf("reconcile wave: disabled; ignoring request")
		return
	}
	select {
	case waveSignal <- struct{}{}:
	default:
	}
}

func workerLoop() {
	for range waveSignal {
		runWave(workerApp)
	}
}

func runWave(app core.App) {
	// Staleness is evaluated with ordinary approved-only resolution: the
	// wave's worklist is exactly the dashboard's "needs action" set.
	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(context.Background())
	if err != nil {
		log.Printf("reconcile wave: evaluate: %v", err)
		return
	}

	// Generation, by contrast, is speculative (candidate-or-approved
	// upstreams) and runs at background priority so interactive work preempts
	// it. Not a request context — the request that started the wave has
	// already returned.
	genCtx := llmq.WithPriority(
		llmcontext.WithChainOrigin(context.Background(), llmcontext.ChainOriginGenerateAll),
		llmq.Background)

	for _, s := range statuses { // EvaluateAll returns dependencies before dependents
		if !needsWork(s) {
			continue
		}
		if err := generateEntity(genCtx, app, s); err != nil {
			// Topological order means everything upstream of this point is
			// done, and a dependent generated now would consume output this
			// failure leaves missing. End the wave; the dashboard keeps
			// showing what remains, and the next "generate all" resumes from
			// a fresh evaluation.
			log.Printf("reconcile wave: %s %s: %v; ending wave", s.Type, s.ID, err)
			return
		}
	}
}

func needsWork(s api.EntityStatus) bool {
	return len(s.NewFragmentIDs) > 0 || len(s.StaleDependencies) > 0 ||
		len(s.BlockedBy) > 0 || len(s.PendingWindows) > 0
}

func generateEntity(ctx context.Context, app core.App, s api.EntityStatus) error {
	var strat engine.Strategy
	var genStatus string
	if s.Type == "reflection" {
		strat = engine.ReflectionStrategy{}
		genStatus = engine.StatusApproved // reflections publish live, as everywhere else
	} else {
		strat = engine.ProjectionStrategy{}
		genStatus = engine.StatusPending // projections get review candidates
	}

	rec, err := app.FindRecordById(strat.CollectionName(), s.ID)
	if err != nil {
		return err
	}

	var windows []*api.Window
	if len(s.PendingWindows) > 0 {
		for i := range s.PendingWindows {
			windows = append(windows, &s.PendingWindows[i])
		}
	} else {
		if engine.SnapshotIsCurrent(ctx, app, strat, rec) {
			return nil
		}
		windows = append(windows, nil)
	}

	for _, w := range windows {
		for {
			_, err := engine.GenerateSnapshot(ctx, app, s.ID, genStatus, strat, w)
			if errors.Is(err, llmq.ErrPreempted) {
				// Interactive work took the slot mid-generation; the task is
				// still in hand — the retry blocks in the scheduler until a
				// slot frees up.
				continue
			}
			if errors.Is(err, engine.ErrLensNotReady) || errors.Is(err, engine.ErrGenerationInFlight) {
				// Someone else is already producing this entity's output (an
				// interactive generation, or the pending lens distillation).
				// Skip it; the next wave re-evaluates from scratch.
				log.Printf("reconcile wave: %s %s: %v; skipping", s.Type, s.ID, err)
				break
			}
			if err != nil {
				return err
			}
			break
		}
	}
	return nil
}
