// UNREVIEWED
package workers

import (
	"context"
	"testing"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestNewManagerAndLifecycle(t *testing.T) {
	app := testutil.NewApp(t)

	mgr := New(app, Options{AutoWave: false})
	if mgr.Colour == nil {
		t.Fatal("expected Colour worker to be initialized")
	}
	if mgr.Mapping == nil {
		t.Fatal("expected Mapping worker to be initialized")
	}
	if mgr.Reconcile == nil {
		t.Fatal("expected Reconcile worker to be initialized")
	}
	if mgr.Discover == nil {
		t.Fatal("expected Discover worker to be initialized")
	}

	// Boot kicks should not block or panic
	mgr.BootKicks()

	ctx, cancel := context.WithCancel(context.Background())
	g, ctx := errgroup.WithContext(ctx)

	mgr.Start(ctx, g)

	// Cancel context to stop all workers
	cancel()

	done := make(chan error, 1)
	go func() {
		done <- g.Wait()
	}()

	select {
	case err := <-done:
		if err != nil && err != context.Canceled {
			t.Fatalf("unexpected error waiting for workers: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("workers failed to stop within 2s after context cancellation")
	}
}
