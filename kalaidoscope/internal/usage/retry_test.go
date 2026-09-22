// UNREVIEWED
package usage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm/queue"
)

func shortRetry(t *testing.T) {
	t.Helper()
	oldI, oldM, oldE := retryInitialInterval, retryMaxInterval, retryMaxElapsed
	retryInitialInterval, retryMaxInterval, retryMaxElapsed = time.Millisecond, 5*time.Millisecond, 200*time.Millisecond
	t.Cleanup(func() { retryInitialInterval, retryMaxInterval, retryMaxElapsed = oldI, oldM, oldE })
}

func TestRetryThrottledRetriesQuotaThenSucceeds(t *testing.T) {
	shortRetry(t)
	calls := 0
	err := RetryThrottled(context.Background(), func() error {
		calls++
		if calls < 3 {
			return &llm.ProviderError{Kind: llm.ErrKindQuota}
		}
		return nil
	})
	if err != nil || calls != 3 {
		t.Fatalf("err=%v calls=%d, want nil after 3", err, calls)
	}
}

func TestRetryThrottledPreemptedReentersAtOnce(t *testing.T) {
	shortRetry(t)
	calls := 0
	start := time.Now()
	err := RetryThrottled(context.Background(), func() error {
		calls++
		if calls < 4 {
			return queue.ErrPreempted
		}
		return nil
	})
	if err != nil || calls != 4 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
	if time.Since(start) > 50*time.Millisecond {
		t.Errorf("preempted retries waited %s; they should re-enter immediately", time.Since(start))
	}
}

func TestRetryThrottledOtherErrorsArePermanent(t *testing.T) {
	shortRetry(t)
	for name, e := range map[string]error{
		"exhausted": ErrExhausted,
		"auth":      &llm.ProviderError{Kind: llm.ErrKindAuth},
		"plain":     errors.New("boom"),
	} {
		calls := 0
		err := RetryThrottled(context.Background(), func() error { calls++; return e })
		if !errors.Is(err, e) || calls != 1 {
			t.Errorf("%s: err=%v calls=%d, want the error back after one call", name, err, calls)
		}
	}
}

func TestRetryThrottledGivesUpAfterBudget(t *testing.T) {
	shortRetry(t)
	want := &llm.ProviderError{Kind: llm.ErrKindTransient}
	err := RetryThrottled(context.Background(), func() error { return want })
	var perr *llm.ProviderError
	if !errors.As(err, &perr) || perr.Kind != llm.ErrKindTransient {
		t.Fatalf("err=%v, want the last transient error once the budget is spent", err)
	}
}

func TestRetryThrottledHonoursContext(t *testing.T) {
	shortRetry(t)
	retryMaxElapsed = time.Hour
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err := RetryThrottled(ctx, func() error { return &llm.ProviderError{Kind: llm.ErrKindQuota} })
	if err == nil {
		t.Fatal("expected an error after the context expired")
	}
}
