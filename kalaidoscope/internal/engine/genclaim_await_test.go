// UNREVIEWED
package engine

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func fastAwait(t *testing.T) {
	t.Helper()
	old := awaitPollInterval
	awaitPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { awaitPollInterval = old })
}

func liveClaim(t *testing.T, app core.App, strat Strategy, parentID string) *core.Record {
	t.Helper()
	return testutil.NewRecord(t, app, strat.SnapshotCollectionName(), map[string]any{
		strat.ForeignKeyCol(): parentID,
		"status":              StatusGenerating,
	})
}

// A second caller joins the running generation and gets the row it fills.
func TestAwaitGenerationReturnsFilledClaim(t *testing.T) {
	app := testutil.NewApp(t)
	fastAwait(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	claim := liveClaim(t, app, strat, proj.Id)

	go func() {
		time.Sleep(20 * time.Millisecond)
		rec, err := app.FindRecordById(strat.SnapshotCollectionName(), claim.Id)
		if err != nil {
			return
		}
		rec.Set("status", StatusPending)
		rec.Set("output", "DONE")
		_ = app.Save(rec)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	id, err := AwaitGeneration(ctx, app, strat, proj.Id, nil)
	if err != nil {
		t.Fatalf("await: %v", err)
	}
	if id != claim.Id {
		t.Errorf("await returned %s, want the filled claim %s", id, claim.Id)
	}
}

// A claim released unfilled means the generation failed: the joiner is told
// so it can generate afresh rather than wait for nothing.
func TestAwaitGenerationReportsAbandonedClaim(t *testing.T) {
	app := testutil.NewApp(t)
	fastAwait(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	claim := liveClaim(t, app, strat, proj.Id)

	go func() {
		time.Sleep(20 * time.Millisecond)
		releaseClaim(app, strat, claim.Id)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := AwaitGeneration(ctx, app, strat, proj.Id, nil); !errors.Is(err, ErrGenerationAbandoned) {
		t.Errorf("await after release: err = %v, want ErrGenerationAbandoned", err)
	}

	// Nothing running at all reads the same way.
	if _, err := AwaitGeneration(ctx, app, strat, proj.Id, nil); !errors.Is(err, ErrGenerationAbandoned) {
		t.Errorf("await with no claim: err = %v, want ErrGenerationAbandoned", err)
	}
}

// The joiner's context bounds the wait.
func TestAwaitGenerationHonoursContext(t *testing.T) {
	app := testutil.NewApp(t)
	fastAwait(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	liveClaim(t, app, strat, proj.Id)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := AwaitGeneration(ctx, app, strat, proj.Id, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("await past deadline: err = %v, want DeadlineExceeded", err)
	}
}
