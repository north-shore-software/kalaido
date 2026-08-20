// Package llmq is the single admission gate for outbound LLM calls.
//
// Every call that reaches a provider first passes through Acquire, which
// enforces a concurrency cap (1 on local Ollama, where parallel generations
// make the machine thrash), spaces out call starts (rate limiting for hosted
// APIs), and orders waiting work by priority. Two responsiveness mechanisms
// are built in: re-ordering (a higher-priority arrival is admitted ahead of
// earlier lower-priority waiters) and preemption (an Interactive arrival
// cancels an in-flight lower-priority call, whose owner retries). Which one
// applies is Config policy, not a caller concern.
//
// Idle-tier work is additionally gated by hysteresis: it starts only after
// IdleAfter of no higher-priority activity, so opportunistic work (colour
// evaluation) doesn't evict a local model's cache between two chat turns.
package llmq

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// Priority orders waiting work; numerically lower runs first. PreemptNone is
// not a schedulable priority — it exists so Config's zero value has preemption
// disabled.
type Priority int

const (
	PreemptNone Priority = iota
	Interactive          // user actively waiting; never preempted, never idle-gated
	Background           // requested work the user isn't blocked on (lens distillation)
	Idle                 // opportunistic work; only runs after a quiet period
)

func (p Priority) String() string {
	switch p {
	case Interactive:
		return "interactive"
	case Background:
		return "background"
	case Idle:
		return "idle"
	}
	return "none"
}

func (p Priority) MarshalJSON() ([]byte, error) {
	return json.Marshal(p.String())
}

// ErrPreempted is the cancellation cause of a run context whose slot was taken
// by Interactive work. The owner of a preempted call is expected to retry —
// re-entering Acquire and waiting its turn — rather than treat it as failure.
var ErrPreempted = errors.New("llmq: call preempted by higher-priority work")

type Config struct {
	MaxConcurrent    int           // in-flight cap; minimum (and Ollama's value) is 1
	MinStartInterval time.Duration // minimum gap between call starts; 0 = no rate limit
	IdleAfter        time.Duration // quiet period before Idle work may start
	// Running tasks at this priority or lower (numerically >=) may be cancelled
	// for an Interactive arrival. PreemptNone — the zero value — disables it.
	PreemptAtOrBelow Priority
}

// ConfigForProvider is the in-code tuning table. The same scheduler runs in
// every deployment shape (local Ollama, local app + hosted API, cloud); only
// these numbers differ.
func ConfigForProvider(p llm.ProviderID) Config {
	switch p {
	case llm.ProviderOllama:
		// One generation at a time — parallel calls force model swapping.
		// Preemption on: an in-flight background/idle generation is cancelled
		// (its owner retries when quiet) rather than making a chat turn wait
		// minutes behind it.
		return Config{
			MaxConcurrent:    1,
			IdleAfter:        5 * time.Minute,
			PreemptAtOrBelow: Background,
		}
	default:
		// Hosted APIs: modest parallelism with spaced-out starts. Preemption
		// buys little when slots are plural and calls are fast.
		return Config{
			MaxConcurrent:    3,
			MinStartInterval: time.Second,
			IdleAfter:        time.Minute,
			PreemptAtOrBelow: PreemptNone,
		}
	}
}

// DefaultPriorityForRole maps a call's role to its usual urgency. Callers whose
// urgency differs from their role (the colour preview: RoleColour, but the
// user is watching) override per call with WithPriority.
func DefaultPriorityForRole(r llm.Role) Priority {
	switch r {
	case llm.RoleDistill, llm.RoleMap, llm.RoleAnnotate:
		return Background
	case llm.RoleColour:
		return Idle
	default:
		return Interactive
	}
}

type ctxKey struct{}

// WithPriority overrides the role-derived priority for calls made under ctx.
func WithPriority(ctx context.Context, p Priority) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

func PriorityFromContext(ctx context.Context, fallback Priority) Priority {
	if p, ok := ctx.Value(ctxKey{}).(Priority); ok {
		return p
	}
	return fallback
}

type Request struct {
	Priority Priority
	Role     llm.Role
	Model    string
}

type TaskInfo struct {
	Role     llm.Role  `json:"role"`
	Priority Priority  `json:"priority"`
	Model    string    `json:"model"`
	Started  time.Time `json:"started"`
	// Streamed output so far, as reported via AddProgress. An estimate — the
	// reporter counts characters, not real tokenizer output.
	Tokens int `json:"tokens,omitempty"`
	// Tokens averaged over the task's whole runtime (including time-to-first-
	// token), so it reads low early in a call.
	TokensPerSecond float64 `json:"tokens_per_second,omitempty"`
}

type Status struct {
	// Version orders asynchronously delivered snapshots so an observer can
	// discard ones that arrive out of order.
	Version uint64         `json:"-"`
	Running []TaskInfo     `json:"running"`
	Waiting map[string]int `json:"waiting,omitempty"` // count per Priority.String()
}

type Scheduler struct {
	mu              sync.Mutex
	cfg             Config
	seq             uint64
	version         uint64
	waiting         []*waiter
	running         []*task
	lastStart       time.Time
	lastNonIdle     time.Time
	lastProgressPub time.Time
	timer           *time.Timer
	onChange        func(Status)
}

type waiter struct {
	req      Request
	seq      uint64
	ctx      context.Context
	admit    chan struct{} // closed on admission, after runCtx/release are set
	admitted bool
	runCtx   context.Context
	release  func()
}

type task struct {
	req        Request
	started    time.Time
	runCtx     context.Context
	cancel     context.CancelCauseFunc
	tokens     int
	preempting bool
}

func New(cfg Config) *Scheduler {
	if cfg.MaxConcurrent < 1 {
		cfg.MaxConcurrent = 1
	}
	return &Scheduler{cfg: cfg}
}

// Reconfigure applies at runtime; a lowered concurrency takes effect as
// running calls drain.
func (s *Scheduler) Reconfigure(cfg Config) {
	if cfg.MaxConcurrent < 1 {
		cfg.MaxConcurrent = 1
	}
	s.mu.Lock()
	s.cfg = cfg
	s.dispatchLocked()
	s.mu.Unlock()
}

func (s *Scheduler) SetOnChange(f func(Status)) {
	s.mu.Lock()
	s.onChange = f
	s.mu.Unlock()
}

// Snapshot returns the current queue state; OnChange delivers the same shape
// on every transition.
func (s *Scheduler) Snapshot() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

// Acquire blocks until the scheduler admits the call, the ctx dies, or —
// never for Interactive — the wait outlives the caller's patience by design
// (Idle work can wait indefinitely for a quiet period).
//
// runCtx is a child of ctx and MUST be the context the provider call runs
// under: the scheduler cancels it (cause ErrPreempted) to preempt. release
// MUST be called when the call finishes, however it finishes.
func (s *Scheduler) Acquire(ctx context.Context, req Request) (runCtx context.Context, release func(), err error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}

	w := &waiter{req: req, ctx: ctx, admit: make(chan struct{})}
	s.mu.Lock()
	s.seq++
	w.seq = s.seq
	if req.Priority != Idle {
		s.lastNonIdle = time.Now()
	}
	s.waiting = append(s.waiting, w)
	sort.SliceStable(s.waiting, func(i, j int) bool {
		if s.waiting[i].req.Priority != s.waiting[j].req.Priority {
			return s.waiting[i].req.Priority < s.waiting[j].req.Priority
		}
		return s.waiting[i].seq < s.waiting[j].seq
	})
	s.dispatchLocked()
	s.mu.Unlock()

	select {
	case <-w.admit:
		return w.runCtx, w.release, nil
	case <-ctx.Done():
		s.mu.Lock()
		admitted := w.admitted
		if !admitted {
			for i, q := range s.waiting {
				if q == w {
					s.waiting = append(s.waiting[:i], s.waiting[i+1:]...)
					break
				}
			}
			s.dispatchLocked()
		}
		s.mu.Unlock()
		if admitted {
			// Dispatch won the race; hand the slot straight back.
			w.release()
		}
		return nil, nil, ctx.Err()
	}
}

// dispatchLocked admits as many waiters as slots, rate spacing, and the idle
// gate allow, triggers preemption for stuck Interactive work, and re-arms the
// wake-up timer for the earliest time-based condition it is waiting on.
func (s *Scheduler) dispatchLocked() {
	now := time.Now()
	var wakeAt time.Time

	for len(s.waiting) > 0 {
		w := s.waiting[0]

		if w.req.Priority == Idle {
			// Idle admission: nothing higher running (nothing higher can be
			// waiting — it would sort ahead of w) and a full quiet period
			// behind us. The running case needs no timer; release re-runs
			// dispatch.
			if s.nonIdleRunningLocked() {
				break
			}
			if ready := s.lastNonIdle.Add(s.cfg.IdleAfter); now.Before(ready) {
				wakeAt = earliest(wakeAt, ready)
				break
			}
		}

		if len(s.running) >= s.cfg.MaxConcurrent {
			if w.req.Priority == Interactive {
				s.preemptLocked()
			}
			break
		}

		if s.cfg.MinStartInterval > 0 && !s.lastStart.IsZero() {
			if ready := s.lastStart.Add(s.cfg.MinStartInterval); now.Before(ready) {
				wakeAt = earliest(wakeAt, ready)
				break
			}
		}

		s.admitLocked(w, now)
	}

	s.armTimerLocked(wakeAt)
	s.publishLocked()
}

func (s *Scheduler) admitLocked(w *waiter, now time.Time) {
	s.waiting = s.waiting[1:]
	runCtx, cancel := context.WithCancelCause(w.ctx)
	t := &task{req: w.req, started: now, runCtx: runCtx, cancel: cancel}
	s.running = append(s.running, t)
	s.lastStart = now
	if w.req.Priority != Idle {
		s.lastNonIdle = now
	}
	var once sync.Once
	w.runCtx = runCtx
	w.release = func() { once.Do(func() { s.finish(t) }) }
	w.admitted = true
	close(w.admit)
}

func (s *Scheduler) finish(t *task) {
	// Cancel causes are sticky: for a preempted task this leaves ErrPreempted
	// visible to its owner; otherwise it just frees the context's resources.
	t.cancel(context.Canceled)
	s.mu.Lock()
	for i, r := range s.running {
		if r == t {
			s.running = append(s.running[:i], s.running[i+1:]...)
			break
		}
	}
	if t.req.Priority != Idle {
		// Completion is activity too: the idle clock starts when the last
		// non-idle call *ends*, not when it began.
		s.lastNonIdle = time.Now()
	}
	s.dispatchLocked()
	s.mu.Unlock()
}

// preemptLocked cancels enough preemptible running tasks to cover the
// Interactive work now waiting. A cancelled task's slot only frees once its
// owner unwinds and calls release, so tasks already being preempted count as
// slots on the way.
func (s *Scheduler) preemptLocked() {
	if s.cfg.PreemptAtOrBelow == PreemptNone {
		return
	}
	needed := 0
	for _, w := range s.waiting {
		if w.req.Priority == Interactive {
			needed++
		}
	}
	if needed > s.cfg.MaxConcurrent {
		needed = s.cfg.MaxConcurrent
	}
	needed -= s.cfg.MaxConcurrent - len(s.running)
	for _, t := range s.running {
		if t.preempting {
			needed--
		}
	}
	for ; needed > 0; needed-- {
		var victim *task
		for _, t := range s.running {
			if t.preempting || t.req.Priority < s.cfg.PreemptAtOrBelow {
				continue
			}
			// Lowest priority first; among equals, the most recently started
			// (least progress to throw away).
			if victim == nil || t.req.Priority > victim.req.Priority ||
				(t.req.Priority == victim.req.Priority && t.started.After(victim.started)) {
				victim = t
			}
		}
		if victim == nil {
			return
		}
		victim.preempting = true
		victim.cancel(ErrPreempted)
	}
}

// AddProgress credits streamed output to the running task identified by its
// run context, so observers can watch throughput mid-generation. Publishes are
// throttled — token deltas arrive per chunk, far faster than a status line
// needs.
func (s *Scheduler) AddProgress(runCtx context.Context, tokens int) {
	if tokens <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.running {
		if t.runCtx == runCtx {
			t.tokens += tokens
			if time.Since(s.lastProgressPub) >= 500*time.Millisecond {
				s.lastProgressPub = time.Now()
				s.publishLocked()
			}
			return
		}
	}
}

func (s *Scheduler) nonIdleRunningLocked() bool {
	for _, t := range s.running {
		if t.req.Priority != Idle {
			return true
		}
	}
	return false
}

func (s *Scheduler) armTimerLocked(wakeAt time.Time) {
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if wakeAt.IsZero() {
		return
	}
	d := time.Until(wakeAt)
	if d < 0 {
		d = 0
	}
	s.timer = time.AfterFunc(d, func() {
		s.mu.Lock()
		s.dispatchLocked()
		s.mu.Unlock()
	})
}

func (s *Scheduler) statusLocked() Status {
	st := Status{Version: s.version}
	for _, t := range s.running {
		info := TaskInfo{
			Role:     t.req.Role,
			Priority: t.req.Priority,
			Model:    t.req.Model,
			Started:  t.started,
			Tokens:   t.tokens,
		}
		if secs := time.Since(t.started).Seconds(); secs > 0.5 && t.tokens > 0 {
			info.TokensPerSecond = float64(t.tokens) / secs
		}
		st.Running = append(st.Running, info)
	}
	if len(s.waiting) > 0 {
		st.Waiting = make(map[string]int, 3)
		for _, w := range s.waiting {
			st.Waiting[w.req.Priority.String()]++
		}
	}
	return st
}

func (s *Scheduler) publishLocked() {
	if s.onChange == nil {
		return
	}
	s.version++
	st := s.statusLocked()
	// Async so a slow observer never sits inside the scheduler lock; Version
	// lets it discard deliveries that arrive out of order.
	go s.onChange(st)
}

func earliest(a, b time.Time) time.Time {
	if a.IsZero() || b.Before(a) {
		return b
	}
	return a
}

// std serves the process. The Ollama config — the strictest shape — is the
// boot default until server wiring reconfigures for the provider actually in
// use.
var std = New(ConfigForProvider(llm.ProviderOllama))

func Acquire(ctx context.Context, req Request) (context.Context, func(), error) {
	return std.Acquire(ctx, req)
}

func AddProgress(runCtx context.Context, tokens int) { std.AddProgress(runCtx, tokens) }

func Reconfigure(cfg Config) { std.Reconfigure(cfg) }

func SetOnChange(f func(Status)) { std.SetOnChange(f) }

func Snapshot() Status { return std.Snapshot() }
