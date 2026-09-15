// Package reconcile keeps the candidate set fresh: a speculative generation
// wave drains the entire stale set in dependency order, each entity generating
// against its upstreams' latest output whether or not it has been approved
// yet. Because approval promotes a snapshot record in place (same ID),
// approving a chain as-is settles every pre-generated dependent with zero
// further generations — the user click-approves through the workspace with no
// waits. Refining one candidate mid-chain supersedes what its dependents
// consumed; the commit re-requests a wave and the downstream subtree
// regenerates.
//
// The wave is not a button. It runs whenever the inputs to a lens can have
// moved — an import finished, a fragment was written from the app, colour
// membership changed, the map settled, something was approved or refined —
// so that by the time the user sits down to reconcile, the work is waiting
// for them. Every wave re-derives the stale set from scratch and skips
// entities whose newest snapshot is already current, so an extra trigger
// costs a status evaluation, not model calls.
//
// It sits above engine (it needs the status evaluator, which imports engine),
// so engine reaches it back through the engine.RequestWave hook.
package reconcile

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/status"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
)

// Buffered by one: a wave requested while one is running coalesces into a
// single follow-up wave, which is sound because every wave re-derives the
// stale set from scratch.
var waveSignal = make(chan struct{}, 1)

var workerApp core.App

// waveDebounce is the quiet period between the last trigger and the wave it
// starts. The triggers arrive in bursts (an import completes, then the colour
// worker drains, then the map settles) and one wave covers all of them.
// A variable so tests can shorten it.
var waveDebounce = 3 * time.Second

// retryBackoff schedules the waves that follow a failed one. A transient
// provider error must not leave the chain half-generated until the next real
// trigger. Quota exhaustion is not retried: the next real trigger re-enters.
var retryBackoff = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}

var (
	timerMu    sync.Mutex
	debounce   *time.Timer
	retryTimer *time.Timer
	retries    int

	running       atomic.Bool
	lastError     atomic.Value // string
	lastCompleted atomic.Value // time.Time
)

// Register wires the wave worker to the app and starts it. Also hands
// engine.RequestWave its implementation, letting refinement commits re-trigger
// a wave without engine importing this package. Once the server is up a wave
// is requested so a run interrupted by a restart resumes from a fresh
// evaluation (the boot sweep has already removed its claim rows).
func Register(app core.App) {
	workerApp = app
	engine.RequestWave = EnqueueWave
	go workerLoop()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := se.Next(); err != nil {
			return err
		}
		EnqueueWave()
		return nil
	})
}

// WaveEnabled reports whether speculative waves run. Always true now; kept so
// the organize status keeps reporting the policy to clients.
func WaveEnabled() bool { return true }

// Running reports whether a wave is in progress.
func Running() bool { return running.Load() }

// LastError is the error that ended the most recent wave, or "" when it ran
// clean (or none has run yet).
func LastError() string {
	if v, ok := lastError.Load().(string); ok {
		return v
	}
	return ""
}

// LastCompleted is when the most recent wave finished without error; zero
// when none has.
func LastCompleted() time.Time {
	if v, ok := lastCompleted.Load().(time.Time); ok {
		return v
	}
	return time.Time{}
}

// EnqueueWave requests a speculative generation wave and returns immediately.
// The wave starts once no further request has arrived for waveDebounce.
func EnqueueWave() {
	timerMu.Lock()
	defer timerMu.Unlock()
	if debounce == nil {
		debounce = time.AfterFunc(waveDebounce, signalWave)
		return
	}
	debounce.Reset(waveDebounce)
}

// OnMapSettled is registered with mapping as a settle hook, after colour's:
// once thing-backed membership has been recomputed from the fresh map, every
// lens that names a colour may resolve differently.
func OnMapSettled(core.App) { EnqueueWave() }

func signalWave() {
	select {
	case waveSignal <- struct{}{}:
	default:
	}
}

func workerLoop() {
	for range waveSignal {
		running.Store(true)
		err := runWave(workerApp)
		running.Store(false)
		afterWave(err)
	}
}

// afterWave records the outcome and decides whether to try again on its own.
func afterWave(err error) {
	timerMu.Lock()
	defer timerMu.Unlock()
	if err == nil {
		lastError.Store("")
		lastCompleted.Store(time.Now())
		retries = 0
		if retryTimer != nil {
			retryTimer.Stop()
			retryTimer = nil
		}
		return
	}
	lastError.Store(err.Error())
	if errors.Is(err, usage.ErrExhausted) {
		log.Printf("reconcile wave: quota exhausted; not retrying")
		return
	}
	delay := retryBackoff[min(retries, len(retryBackoff)-1)]
	retries++
	if retryTimer != nil {
		retryTimer.Stop()
	}
	retryTimer = time.AfterFunc(delay, signalWave)
	log.Printf("reconcile wave: retrying in %s", delay)
}

// runWave generates the whole stale set once. The returned error is the one
// that ended the wave early; nil means every entity that needed work was
// generated or deliberately skipped.
func runWave(app core.App) error {
	// Staleness is evaluated with ordinary approved-only resolution: the
	// wave's worklist is exactly the dashboard's "needs action" set.
	statuses, err := status.NewEvaluator(app, time.Now()).EvaluateAll(context.Background())
	if err != nil {
		log.Printf("reconcile wave: evaluate: %v", err)
		return fmt.Errorf("evaluate: %w", err)
	}

	// Generation, by contrast, is speculative (candidate-or-approved
	// upstreams) and runs at background priority so interactive work preempts
	// it. Not a request context — the request that started the wave has
	// already returned.
	genCtx := llmq.WithPriority(
		llmcontext.WithGenerationTrigger(context.Background(), llmcontext.TriggerGenerateAll),
		llmq.Background)

	for _, s := range statuses { // EvaluateAll returns dependencies before dependents
		if !needsWork(s) {
			continue
		}
		if err := generateEntity(genCtx, app, s); err != nil {
			// Topological order means everything upstream of this point is
			// done, and a dependent generated now would consume output this
			// failure leaves missing. End the wave; the dashboard keeps
			// showing what remains, and the next wave resumes from a fresh
			// evaluation.
			log.Printf("reconcile wave: %s %s: %v; ending wave", s.Type, s.ID, err)
			return fmt.Errorf("%s %s: %w", s.Type, s.ID, err)
		}
	}
	return nil
}

func needsWork(s api.EntityStatus) bool {
	return len(s.NewFragmentIDs) > 0 || len(s.StaleDependencies) > 0 ||
		len(s.BlockedBy) > 0 || len(s.PendingWindows) > 0 || len(s.StaleWindows) > 0
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

	rec, err := engine.FindLive(app, strat, s.ID)
	if err != nil {
		// Deleted (or hard-removed) since the wave was evaluated: nothing to
		// produce for it, and no reason to end the wave for the others.
		log.Printf("reconcile wave: %s %s: %v; skipping", s.Type, s.ID, err)
		return nil
	}

	var windows []*api.Window
	if len(s.PendingWindows)+len(s.StaleWindows) > 0 {
		for i := range s.PendingWindows {
			windows = append(windows, &s.PendingWindows[i])
		}
		for i := range s.StaleWindows {
			windows = append(windows, &s.StaleWindows[i])
		}
	} else {
		if s.Type == "reflection" && len(engine.CurrentGridWindows(rec, time.Now())) > 0 {
			// A scheduled reflection owes nothing: its windows are all
			// generated and fresh. A windowless snapshot is never the answer.
			return nil
		}
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
				// interactive generation), or it has never had a refinement
				// committed. Skip it; the next wave re-evaluates from scratch.
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
