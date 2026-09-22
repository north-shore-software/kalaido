// UNREVIEWED
package workerutil

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestSignalNotifyAndCoalesce(t *testing.T) {
	s := NewSignal()

	// Multiple notifications should coalesce into one
	for range 10 {
		s.Notify()
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if err := s.Wait(ctx); err != nil {
		t.Fatalf("expected signal, got error: %v", err)
	}

	// Buffer should now be empty
	select {
	case <-s.C():
		t.Fatal("buffer should have been drained after Wait")
	default:
	}
}

func TestSignalWaitCancelledContext(t *testing.T) {
	s := NewSignal()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	if err := s.Wait(ctx); err != context.Canceled {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func TestSignalConcurrentNotifies(t *testing.T) {
	s := NewSignal()
	var wg sync.WaitGroup

	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.Notify()
		}()
	}
	wg.Wait()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if err := s.Wait(ctx); err != nil {
		t.Fatalf("expected signal, got: %v", err)
	}
}
