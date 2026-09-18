package usage

import (
	"context"
	"errors"
	"time"

	"github.com/cenkalti/backoff/v4"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmq"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// Retry policy for RetryThrottled. Variables so tests can shorten them.
var (
	retryInitialInterval = 2 * time.Second
	retryMaxInterval     = time.Minute
	retryMaxElapsed      = 3 * time.Minute
)

// RetryThrottled runs a background model call until it succeeds, fails for
// good, or the retry budget runs out.
//
// A call the scheduler preempted (llmq.ErrPreempted) is re-entered at once:
// it lost its slot to an interactive request and simply queues again. A
// provider throttle or transient fault (llm.ErrKindQuota, ErrKindTransient)
// is retried with exponential backoff and jitter, so a 429 storm from one
// worker does not hammer the provider. Every other error, ErrExhausted
// included, returns immediately. ctx cancels the wait between attempts.
func RetryThrottled(ctx context.Context, f func() error) error {
	bo := backoff.NewExponentialBackOff()
	bo.InitialInterval = retryInitialInterval
	bo.MaxInterval = retryMaxInterval
	bo.MaxElapsedTime = retryMaxElapsed
	bo.Reset()
	return backoff.Retry(func() error {
		var err error
		for {
			if err := ctx.Err(); err != nil {
				return backoff.Permanent(err)
			}
			err = f()
			if !errors.Is(err, llmq.ErrPreempted) {
				break
			}
		}
		if err == nil {
			return nil
		}
		var perr *llm.ProviderError
		if errors.As(err, &perr) && (perr.Kind == llm.ErrKindQuota || perr.Kind == llm.ErrKindTransient) {
			return err
		}
		return backoff.Permanent(err)
	}, backoff.WithContext(bo, ctx))
}
