package llmq

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func request(p Priority) Request {
	return Request{Priority: p, Role: llm.RoleChat, Model: "test"}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func totalWaiting(s *Scheduler) int {
	n := 0
	for _, c := range s.Snapshot().Waiting {
		n += c
	}
	return n
}

func mustAcquire(t *testing.T, s *Scheduler, req Request) (context.Context, func()) {
	t.Helper()
	runCtx, release, err := s.Acquire(context.Background(), req)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	return runCtx, release
}

func TestConcurrencyOneSerializesFIFO(t *testing.T) {
	s := New(Config{MaxConcurrent: 1})
	_, rel1 := mustAcquire(t, s, request(Interactive))

	var mu sync.Mutex
	var order []string
	var wg sync.WaitGroup
	start := func(name string) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, rel := mustAcquire(t, s, request(Interactive))
			mu.Lock()
			order = append(order, name)
			mu.Unlock()
			rel()
		}()
	}

	start("b")
	waitFor(t, "b queued", func() bool { return totalWaiting(s) == 1 })
	start("c")
	waitFor(t, "c queued", func() bool { return totalWaiting(s) == 2 })

	rel1()
	wg.Wait()

	if len(order) != 2 || order[0] != "b" || order[1] != "c" {
		t.Fatalf("expected FIFO order [b c], got %v", order)
	}
}

func TestHigherPriorityJumpsQueue(t *testing.T) {
	s := New(Config{MaxConcurrent: 1})
	_, rel1 := mustAcquire(t, s, request(Interactive))

	var mu sync.Mutex
	var order []string
	var wg sync.WaitGroup
	start := func(name string, p Priority) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, rel := mustAcquire(t, s, request(p))
			mu.Lock()
			order = append(order, name)
			mu.Unlock()
			rel()
		}()
	}

	start("background", Background)
	waitFor(t, "background queued", func() bool { return totalWaiting(s) == 1 })
	start("interactive", Interactive)
	waitFor(t, "interactive queued", func() bool { return totalWaiting(s) == 2 })

	rel1()
	wg.Wait()

	if len(order) != 2 || order[0] != "interactive" || order[1] != "background" {
		t.Fatalf("expected [interactive background], got %v", order)
	}
}

func TestRateGapSpacesStarts(t *testing.T) {
	const gap = 100 * time.Millisecond
	s := New(Config{MaxConcurrent: 2, MinStartInterval: gap})

	t0 := time.Now()
	_, rel1 := mustAcquire(t, s, request(Interactive))
	_, rel2 := mustAcquire(t, s, request(Interactive))
	elapsed := time.Since(t0)
	rel1()
	rel2()

	if elapsed < gap-20*time.Millisecond {
		t.Fatalf("second start after %v, want ≥ %v", elapsed, gap)
	}
}

func TestIdleWaitsForQuietPeriod(t *testing.T) {
	const idleAfter = 120 * time.Millisecond
	s := New(Config{MaxConcurrent: 1, IdleAfter: idleAfter})

	// Non-idle activity: the idle clock starts when this completes.
	_, rel := mustAcquire(t, s, request(Interactive))
	rel()

	t0 := time.Now()
	_, relIdle := mustAcquire(t, s, request(Idle))
	elapsed := time.Since(t0)
	relIdle()

	if elapsed < idleAfter-20*time.Millisecond {
		t.Fatalf("idle admitted after %v, want ≥ %v", elapsed, idleAfter)
	}
}

func TestNonIdleActivityResetsIdleClock(t *testing.T) {
	const idleAfter = 150 * time.Millisecond
	s := New(Config{MaxConcurrent: 1, IdleAfter: idleAfter})

	_, rel := mustAcquire(t, s, request(Interactive))
	rel()

	admitted := make(chan time.Time, 1)
	go func() {
		_, relIdle := mustAcquire(t, s, request(Idle))
		admitted <- time.Now()
		relIdle()
	}()
	waitFor(t, "idle queued", func() bool { return totalWaiting(s) == 1 })

	// New interactive activity mid-wait pushes the idle admission out.
	time.Sleep(50 * time.Millisecond)
	_, rel2 := mustAcquire(t, s, request(Interactive))
	rel2()
	t1 := time.Now()

	at := <-admitted
	if since := at.Sub(t1); since < idleAfter-20*time.Millisecond {
		t.Fatalf("idle admitted %v after last activity, want ≥ %v", since, idleAfter)
	}
}

func TestPreemptionCancelsRunningTask(t *testing.T) {
	s := New(Config{MaxConcurrent: 1, PreemptAtOrBelow: Background})

	idleCtx, relIdle := mustAcquire(t, s, request(Idle))

	interactiveDone := make(chan struct{})
	go func() {
		defer close(interactiveDone)
		_, rel := mustAcquire(t, s, request(Interactive))
		rel()
	}()

	select {
	case <-idleCtx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("idle task was not preempted")
	}
	if cause := context.Cause(idleCtx); !errors.Is(cause, ErrPreempted) {
		t.Fatalf("cancel cause = %v, want ErrPreempted", cause)
	}

	// The slot frees only when the preempted owner releases.
	select {
	case <-interactiveDone:
		t.Fatal("interactive admitted before preempted task released")
	case <-time.After(30 * time.Millisecond):
	}
	relIdle()

	select {
	case <-interactiveDone:
	case <-time.After(2 * time.Second):
		t.Fatal("interactive not admitted after preempted task released")
	}
}

func TestPreemptionDisabledByDefault(t *testing.T) {
	s := New(Config{MaxConcurrent: 1}) // zero PreemptAtOrBelow = PreemptNone

	idleCtx, relIdle := mustAcquire(t, s, request(Idle))

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, rel := mustAcquire(t, s, request(Interactive))
		rel()
	}()
	waitFor(t, "interactive queued", func() bool { return totalWaiting(s) == 1 })

	select {
	case <-idleCtx.Done():
		t.Fatal("running task cancelled despite preemption being disabled")
	case <-time.After(50 * time.Millisecond):
	}

	relIdle()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("interactive not admitted after release")
	}
}

func TestWaiterRemovedOnContextCancel(t *testing.T) {
	s := New(Config{MaxConcurrent: 1})
	_, rel := mustAcquire(t, s, request(Interactive))

	cctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, _, err := s.Acquire(cctx, request(Interactive))
		errCh <- err
	}()
	waitFor(t, "waiter queued", func() bool { return totalWaiting(s) == 1 })

	cancel()
	if err := <-errCh; err == nil {
		t.Fatal("Acquire returned nil error for cancelled context")
	}
	waitFor(t, "waiter removed", func() bool { return totalWaiting(s) == 0 })
	rel()
}

func TestReconfigureRaisesConcurrency(t *testing.T) {
	s := New(Config{MaxConcurrent: 1})
	_, rel1 := mustAcquire(t, s, request(Interactive))

	admitted := make(chan struct{})
	go func() {
		defer close(admitted)
		_, rel2 := mustAcquire(t, s, request(Interactive))
		rel2()
	}()
	waitFor(t, "second call queued", func() bool { return totalWaiting(s) == 1 })

	s.Reconfigure(Config{MaxConcurrent: 2})

	select {
	case <-admitted:
	case <-time.After(2 * time.Second):
		t.Fatal("blocked waiter not admitted after Reconfigure")
	}
	rel1()
}

func TestAddProgressShowsInSnapshot(t *testing.T) {
	s := New(Config{MaxConcurrent: 1})
	runCtx, rel := mustAcquire(t, s, request(Interactive))

	s.AddProgress(runCtx, 100)
	s.AddProgress(runCtx, 50)

	snap := s.Snapshot()
	if len(snap.Running) != 1 || snap.Running[0].Tokens != 150 {
		t.Fatalf("expected 150 tokens on the running task, got %+v", snap.Running)
	}

	// Progress against a context the scheduler doesn't know is ignored.
	s.AddProgress(context.Background(), 10)
	if got := s.Snapshot().Running[0].Tokens; got != 150 {
		t.Fatalf("unknown-context progress leaked in: %d tokens", got)
	}
	rel()
}

func TestOnChangePublishesStatus(t *testing.T) {
	s := New(Config{MaxConcurrent: 1})

	var mu sync.Mutex
	var latest Status
	s.SetOnChange(func(st Status) {
		mu.Lock()
		if st.Version > latest.Version {
			latest = st
		}
		mu.Unlock()
	})

	_, rel := mustAcquire(t, s, request(Interactive))
	waitFor(t, "running visible", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(latest.Running) == 1 && latest.Running[0].Role == llm.RoleChat
	})
	rel()
	waitFor(t, "empty after release", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(latest.Running) == 0 && len(latest.Waiting) == 0
	})
}
