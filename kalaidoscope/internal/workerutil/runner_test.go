// UNREVIEWED
package workerutil

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestTrackedRunnerRunsAndWaits(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runner := NewTrackedRunner(ctx)
	var executed atomic.Int32

	runner.Go(func(ctx context.Context) {
		time.Sleep(10 * time.Millisecond)
		executed.Add(1)
	})

	runner.Wait()
	if executed.Load() != 1 {
		t.Errorf("executed = %d, want 1", executed.Load())
	}
}

func TestInlineRunnerExecutesSynchronously(t *testing.T) {
	var runner InlineRunner
	var executed bool

	runner.Go(func(ctx context.Context) {
		executed = true
	})

	if !executed {
		t.Error("expected InlineRunner to execute synchronously")
	}
}

func TestDiscardRunnerDropsWork(t *testing.T) {
	var runner DiscardRunner
	var executed bool

	runner.Go(func(ctx context.Context) {
		executed = true
	})

	if executed {
		t.Error("expected DiscardRunner to drop task without execution")
	}
}
