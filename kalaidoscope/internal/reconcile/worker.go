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
// By default the wave is a button: the user starts the reconcile ritual from
// the dashboard (POST /api/reconcile → StartWave) and the wave prepares every
// stop of the walk. With KALAIDO_AUTO_WAVE set, it also runs whenever the
// inputs to a lens can have moved — an import finished, a fragment was written
// from the app, colour membership changed, the map settled, something was
// approved or refined — so the work is waiting before the user sits down
// (EnqueueWave, a no-op otherwise). Every wave re-derives the stale set from
// scratch and skips entities whose newest snapshot is already current, so an
// extra trigger costs a status evaluation, not model calls.
//
// It sits above engine (it needs the status evaluator, which imports engine);
// the handler that commits a refinement asks it for the follow-up wave.
package reconcile

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/usage"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
)

// Options tune a Worker.
type Options struct {
	// AutoWave turns on the automatic triggers (EnqueueWave). Off, the only
	// wave is the one the user starts (StartWave).
	AutoWave bool
	// Debounce is the quiet period between the last automatic trigger and
	// the wave it starts; zero means the default. The triggers arrive in
	// bursts (an import completes, then the colour worker drains, then the
	// map settles) and one wave covers all of them.
	Debounce time.Duration
}

const defaultDebounce = 3 * time.Second

// defaultRetryBackoff schedules the waves that follow a failed one. A
// transient provider error must not leave the chain half-generated until
// the next real trigger. Quota exhaustion is not retried: the next real
// trigger re-enters.
var defaultRetryBackoff = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}

// Worker runs speculative generation waves. One per process, owned by the
// server; Run drives it.
type Worker struct {
	app    core.App
	logger *slog.Logger
	// Buffered by one: a wave requested while one is running coalesces into
	// a single follow-up wave, which is sound because every wave re-derives
	// the stale set from scratch.
	signal workerutil.Signal

	autoWave     bool
	debounceFor  time.Duration
	retryBackoff []time.Duration

	timerMu    sync.Mutex
	debounce   *time.Timer
	retryTimer *time.Timer
	retries    int

	// One lock for the whole status so a reader never sees a wave's
	// lastStarted without its running flag (the client tells "the wave I
	// started has ended" from exactly that pair).
	stateMu       sync.Mutex
	running       bool
	lastStarted   time.Time
	lastError     string
	lastCompleted time.Time
	lastCancelled time.Time
	currentEntity *api.CurrentEntityInfo
	progress      *api.WaveProgress
	waveCancel    context.CancelFunc
}

func (w *Worker) CancelWave() {
	w.stateMu.Lock()
	cancel := w.waveCancel
	w.waveCancel = nil
	if w.running {
		w.lastCancelled = time.Now()
	}
	w.stateMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func logger(app core.App) *slog.Logger {
	if app != nil {
		return app.Logger().With("component", "reconcile")
	}
	return slog.Default().With("component", "reconcile")
}

// NewWorker builds the worker over app. Nothing runs until Run.
func NewWorker(app core.App, opts Options) *Worker {
	if opts.Debounce == 0 {
		opts.Debounce = defaultDebounce
	}
	return &Worker{
		app:          app,
		logger:       logger(app),
		signal:       workerutil.NewSignal(),
		autoWave:     opts.AutoWave,
		debounceFor:  opts.Debounce,
		retryBackoff: defaultRetryBackoff,
	}
}

// LogPolicy writes the boot line saying whether waves start on their own.
func (w *Worker) LogPolicy() {
	if w.autoWave {
		w.logger.Info("automatic waves on", "env", "KALAIDO_AUTO_WAVE")
	} else {
		w.logger.Info("automatic waves off; KALAIDO_AUTO_WAVE=1 enables them; the dashboard starts the wave", "env", "KALAIDO_AUTO_WAVE")
	}
}

// WaveEnabled reports whether waves start on their own (KALAIDO_AUTO_WAVE).
// Surfaced to clients as the organize status policy.
func (w *Worker) WaveEnabled() bool { return w.autoWave }

type State struct {
	Running       bool
	LastStarted   time.Time
	LastError     string
	LastCompleted time.Time
	LastCancelled time.Time
	CurrentEntity *api.CurrentEntityInfo
	Progress      *api.WaveProgress
}

func (w *Worker) Status() State {
	w.stateMu.Lock()
	defer w.stateMu.Unlock()
	st := State{
		Running:       w.running,
		LastStarted:   w.lastStarted,
		LastError:     w.lastError,
		LastCompleted: w.lastCompleted,
		LastCancelled: w.lastCancelled,
	}
	if w.currentEntity != nil {
		copyEntity := *w.currentEntity
		st.CurrentEntity = &copyEntity
	}
	if w.progress != nil {
		copyProg := *w.progress
		st.Progress = &copyProg
	}
	return st
}

func (w *Worker) EvaluateStatus() api.ReconcileStatus {
	wave := w.Status()
	st := api.ReconcileStatus{
		Running:       wave.Running,
		LastError:     wave.LastError,
		CurrentEntity: wave.CurrentEntity,
		Progress:      wave.Progress,
	}
	if !wave.LastStarted.IsZero() {
		st.LastStarted = wave.LastStarted.UTC().Format(time.RFC3339)
	}
	if !wave.LastCompleted.IsZero() {
		st.LastCompleted = wave.LastCompleted.UTC().Format(time.RFC3339)
	}
	if !wave.LastCancelled.IsZero() {
		st.LastCancelled = wave.LastCancelled.UTC().Format(time.RFC3339)
	}
	return st
}

// EnqueueWave is the automatic trigger: it requests a speculative generation
// wave and returns immediately. The wave starts once no further request has
// arrived for the debounce period. Without AutoWave it does nothing — the
// user starts the wave (StartWave).
func (w *Worker) EnqueueWave() {
	if !w.autoWave {
		return
	}
	w.timerMu.Lock()
	defer w.timerMu.Unlock()
	if w.debounce == nil {
		w.debounce = time.AfterFunc(w.debounceFor, w.signalWave)
		return
	}
	w.debounce.Reset(w.debounceFor)
}

// StartWave is the explicit trigger — the user pressed Start. It signals the
// worker at once, with no quiet period, and cancels any automatic request
// still waiting to fire (the wave it would have started is this one).
func (w *Worker) StartWave() {
	w.timerMu.Lock()
	if w.debounce != nil {
		w.debounce.Stop()
		w.debounce = nil
	}
	w.timerMu.Unlock()
	w.signalWave()
}

// OnMapSettled is registered with mapping as a settle hook, after colour's:
// once thing-backed membership has been recomputed from the fresh map, every
// lens that names a colour may resolve differently.
func (w *Worker) OnMapSettled(core.App) { w.EnqueueWave() }

func (w *Worker) signalWave() {
	w.signal.Notify()
}

// Run runs a wave on every signal until ctx is cancelled, then stops the
// timers and returns ctx.Err(). A wave in progress finishes its current
// entity first.
func (w *Worker) Run(ctx context.Context) error {
	defer w.stopTimers()
	for {
		if err := w.signal.Wait(ctx); err != nil {
			return err
		}
		waveCtx, cancel := context.WithCancel(ctx)
		w.stateMu.Lock()
		w.running, w.lastStarted = true, time.Now()
		w.currentEntity = nil
		w.progress = nil
		w.waveCancel = cancel
		w.stateMu.Unlock()
		err := runWaveWithWorker(waveCtx, w.app, w)
		w.stateMu.Lock()
		w.waveCancel = nil
		w.stateMu.Unlock()
		cancel()
		w.afterWave(err)
	}
}

func (w *Worker) stopTimers() {
	w.timerMu.Lock()
	defer w.timerMu.Unlock()
	if w.debounce != nil {
		w.debounce.Stop()
		w.debounce = nil
	}
	if w.retryTimer != nil {
		w.retryTimer.Stop()
		w.retryTimer = nil
	}
	w.retries = 0
}

// afterWave records the outcome and decides whether to try again on its own.
func (w *Worker) afterWave(err error) {
	w.stateMu.Lock()
	w.running = false
	w.currentEntity = nil
	if err == nil {
		w.lastError, w.lastCompleted = "", time.Now()
	} else if errors.Is(err, context.Canceled) {
		w.lastError = ""
	} else {
		w.lastError = err.Error()
	}
	w.stateMu.Unlock()

	w.timerMu.Lock()
	defer w.timerMu.Unlock()
	if err == nil {
		w.retries = 0
		if w.retryTimer != nil {
			w.retryTimer.Stop()
			w.retryTimer = nil
		}
		return
	}
	if errors.Is(err, usage.ErrExhausted) {
		w.logger.Warn("wave quota exhausted; not retrying")
		return
	}
	if errors.Is(err, context.Canceled) {
		return
	}
	delay := w.retryBackoff[min(w.retries, len(w.retryBackoff)-1)]
	w.retries++
	if w.retryTimer != nil {
		w.retryTimer.Stop()
	}
	w.retryTimer = time.AfterFunc(delay, w.signalWave)
	w.logger.Warn("wave retrying", "delay", delay)
}

func runWave(ctx context.Context, app core.App) error {
	return runWaveWithWorker(ctx, app, nil)
}

func runWaveWithWorker(ctx context.Context, app core.App, w *Worker) error {
	log := logger(app)
	statuses, err := NewEvaluator(app, time.Now()).EvaluateAll(ctx)
	if err != nil {
		log.Error("wave evaluate failed", "error", err)
		return fmt.Errorf("evaluate: %w", err)
	}

	genCtx := queue.WithPriority(
		llmcontext.WithGenerationTrigger(ctx, llmcontext.TriggerGenerateAll),
		queue.Background)

	var worklist []api.EntityStatus
	for _, s := range statuses {
		if needsWork(s) {
			worklist = append(worklist, s)
		}
	}

	if w != nil {
		w.stateMu.Lock()
		w.progress = &api.WaveProgress{Completed: 0, Total: len(worklist)}
		w.stateMu.Unlock()
	}

	for _, s := range worklist {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if w != nil {
			w.stateMu.Lock()
			w.currentEntity = &api.CurrentEntityInfo{ID: s.ID, Type: s.Type}
			w.stateMu.Unlock()
		}
		if err := generateEntity(genCtx, app, s); err != nil {
			log.Error("wave generate failed; ending wave", "target_type", s.Type, "target_id", s.ID, "error", err)
			return fmt.Errorf("%s %s: %w", s.Type, s.ID, err)
		}
		if w != nil {
			w.stateMu.Lock()
			if w.progress != nil {
				w.progress.Completed++
			}
			w.currentEntity = nil
			w.stateMu.Unlock()
		}
	}
	return nil
}

func needsWork(s api.EntityStatus) bool {
	return len(s.NewFragmentIDs) > 0 || len(s.StaleDependencies) > 0 ||
		len(s.BlockedBy) > 0 || len(s.PendingWindows) > 0 || len(s.StaleWindows) > 0
}

func generateEntity(ctx context.Context, app core.App, s api.EntityStatus) error {
	log := logger(app)
	var strat engine.Strategy
	var genStatus string
	if s.Type == "reflection" {
		strat = reflections.Strategy{}
		genStatus = engine.StatusApproved // reflections publish live, as everywhere else
	} else {
		strat = projections.Strategy{}
		genStatus = engine.StatusPending // projections get review candidates
	}

	rec, err := engine.FindLive(app, strat, s.ID)
	if err != nil {
		// Deleted (or hard-removed) since the wave was evaluated: nothing to
		// produce for it, and no reason to end the wave for the others.
		log.Warn("wave target skipped", "target_type", s.Type, "target_id", s.ID, "error", err)
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
		if s.Type == "reflection" && len(reflections.CurrentGridWindows(rec, time.Now())) > 0 {
			// A scheduled reflection owes nothing: its windows are all
			// generated and fresh. A windowless snapshot is never the answer.
			return nil
		}
		if engine.SnapshotIsCurrent(ctx, app, strat, rec) {
			return nil
		}
		windows = append(windows, nil)
	}

	for _, win := range windows {
		for {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			_, err := engine.GenerateSnapshot(ctx, app, s.ID, genStatus, strat, win)
			if errors.Is(err, queue.ErrPreempted) {
				// Interactive work took the slot mid-generation; the task is
				// still in hand — the retry blocks in the scheduler until a
				// slot frees up.
				continue
			}
			if errors.Is(err, engine.ErrLensNotReady) || errors.Is(err, engine.ErrGenerationInFlight) {
				// Someone else is already producing this entity's output (an
				// interactive generation), or it has never had a refinement
				// committed. Skip it; the next wave re-evaluates from scratch.
				log.Warn("wave target skipped", "target_type", s.Type, "target_id", s.ID, "error", err)
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
