package engine

import (
	"context"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// A waiter learns of the fill from the hub, not the poll: with the poll set
// far out, the await still returns as soon as the claim is completed.
func TestAwaitGenerationWakesOnSettleWithoutPolling(t *testing.T) {
	app := testutil.NewApp(t)
	old := awaitPollInterval
	awaitPollInterval = time.Hour
	t.Cleanup(func() { awaitPollInterval = old })

	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	claimID, err := ClaimGeneration(app, strat, proj.Id, nil)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(20 * time.Millisecond)
		_ = completeClaimedSnapshot(context.Background(), app, strat, claimID, SnapshotSpec{SourceID: proj.Id, Output: "DONE", Status: StatusPending})
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	start := time.Now()
	id, err := AwaitGeneration(ctx, app, strat, proj.Id, nil)
	if err != nil {
		t.Fatalf("await: %v", err)
	}
	if id != claimID {
		t.Errorf("await returned %s, want %s", id, claimID)
	}
	if time.Since(start) > time.Second {
		t.Errorf("await took %s; the hub should have woken it", time.Since(start))
	}
}

func TestClaimHubUnsubscribeDropsWaiter(t *testing.T) {
	t.Parallel()
	h := &claimHub{waiters: map[string][]chan struct{}{}}
	a, b := h.subscribe("x"), h.subscribe("x")
	h.unsubscribe("x", a)
	h.settle("x")
	select {
	case <-b:
	default:
		t.Error("remaining waiter not woken")
	}
	select {
	case <-a:
		t.Error("unsubscribed waiter was woken")
	default:
	}
	if len(h.waiters) != 0 {
		t.Errorf("waiters left after settle: %v", h.waiters)
	}
}
