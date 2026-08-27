package engine

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func snapshotRows(t *testing.T, app core.App, strat Strategy, parentID string) []*core.Record {
	t.Helper()
	recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
		strat.ForeignKeyCol()+" = {:id}", "created", 0, 0, dbx.Params{"id": parentID})
	if err != nil {
		t.Fatal(err)
	}
	return recs
}

// A target whose lens has not been distilled yet must refuse to generate — not
// persist an empty document as a reviewable candidate.
func TestGenerateSnapshotLensNotReadyRefuses(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := pbtest.NewRecord(t, app, "projection", map[string]any{
		"name":            "T",
		"current_lens_id": "", // distillation still pending
	})
	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		t.Error("no model call expected while the lens is not ready")
		return "", nil
	}}
	script.install(t)

	_, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if !errors.Is(err, ErrLensNotReady) {
		t.Fatalf("err = %v, want ErrLensNotReady", err)
	}
	if rows := snapshotRows(t, app, strat, proj.Id); len(rows) != 0 {
		t.Errorf("snapshot rows = %d, want none", len(rows))
	}
}

// A live claim row blocks a second generation for the same target; a claim
// older than the TTL belongs to a dead run and is taken over.
func TestGenerateSnapshotInFlightGuard(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		return "OUT", nil
	}}
	script.install(t)

	claimID, err := claimGeneration(app, strat, proj.Id, "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil); !errors.Is(err, ErrGenerationInFlight) {
		t.Fatalf("err = %v, want ErrGenerationInFlight", err)
	}

	// Age the claim past the TTL: the next generation takes over.
	claim, err := app.FindRecordById(strat.SnapshotCollectionName(), claimID)
	if err != nil {
		t.Fatal(err)
	}
	stale, _ := types.ParseDateTime(time.Now().Add(-generationClaimTTL - time.Minute))
	claim.Set("generation_timestamp", stale)
	if err := app.Save(claim); err != nil {
		t.Fatal(err)
	}

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	rows := snapshotRows(t, app, strat, proj.Id)
	if len(rows) != 1 || rows[0].Id != snapID {
		t.Fatalf("rows = %d, want exactly the new snapshot (dead claim deleted)", len(rows))
	}
	if got := rows[0].GetString("status"); got != StatusPending {
		t.Errorf("status = %q, want pending", got)
	}
}

// A generation whose caller context dies mid-stream must persist nothing: no
// truncated candidate, no leftover claim row.
func TestGenerateSnapshotCancelledStreamPersistsNothing(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")

	ctx, cancel := context.WithCancel(context.Background())
	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		cancel() // the caller goes away while the stream is mid-flight
		return "PARTIAL TEXT CUT MID-", nil
	}}
	script.install(t)

	_, err := GenerateSnapshot(ctx, app, proj.Id, StatusPending, strat, nil)
	if err == nil {
		t.Fatal("want an error for a cancelled generation, got success")
	}
	if rows := snapshotRows(t, app, strat, proj.Id); len(rows) != 0 {
		t.Errorf("snapshot rows = %d, want none (claim released, nothing stored)", len(rows))
	}
}

// A fresh pending candidate supersedes the previous one: at most one
// reviewable candidate per target.
func TestGenerateSnapshotSupersedesPriorPending(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	old := pbtest.NewRecord(t, app, strat.SnapshotCollectionName(), map[string]any{
		strat.ForeignKeyCol(): proj.Id,
		"lens_id":             proj.GetString("current_lens_id"),
		"output":              pbutil.JSONString("OLD CANDIDATE"),
		"status":              StatusPending,
	})
	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		return "NEW CANDIDATE", nil
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	oldRec, err := app.FindRecordById(strat.SnapshotCollectionName(), old.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := oldRec.GetString("status"); got != StatusDiscarded {
		t.Errorf("old candidate status = %q, want discarded", got)
	}
	newRec, err := app.FindRecordById(strat.SnapshotCollectionName(), snapID)
	if err != nil {
		t.Fatal(err)
	}
	if got := newRec.GetString("status"); got != StatusPending {
		t.Errorf("new candidate status = %q, want pending", got)
	}
}

// Approve is the circuit breaker: it refuses candidates that were never really
// generated, and discards pending siblings of the one it promotes.
func TestApproveSnapshotGuards(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")

	newPending := func(output string) *core.Record {
		return pbtest.NewRecord(t, app, strat.SnapshotCollectionName(), map[string]any{
			strat.ForeignKeyCol(): proj.Id,
			"output":              pbutil.JSONString(output),
			"status":              StatusPending,
		})
	}

	empty := newPending("")
	if err := ApproveSnapshot(context.Background(), app, strat, empty.Id); !errors.Is(err, ErrNotApprovable) {
		t.Fatalf("approve empty: err = %v, want ErrNotApprovable", err)
	}

	sibling := newPending("SIBLING")
	winner := newPending("WINNER")
	if err := ApproveSnapshot(context.Background(), app, strat, winner.Id); err != nil {
		t.Fatal(err)
	}
	promoted, _ := app.FindRecordById(strat.SnapshotCollectionName(), winner.Id)
	if promoted.GetString("status") != StatusApproved || promoted.GetInt("approval_sequence_number") != 1 {
		t.Errorf("winner not promoted: status=%q seq=%d",
			promoted.GetString("status"), promoted.GetInt("approval_sequence_number"))
	}
	for _, loser := range []*core.Record{sibling, empty} {
		rec, _ := app.FindRecordById(strat.SnapshotCollectionName(), loser.Id)
		if got := rec.GetString("status"); got != StatusDiscarded {
			t.Errorf("sibling %s status = %q, want discarded", loser.Id, got)
		}
	}

	// A discarded candidate stays refused even if approve is called on it later.
	if err := ApproveSnapshot(context.Background(), app, strat, sibling.Id); !errors.Is(err, ErrNotApprovable) {
		t.Errorf("approve discarded: err = %v, want ErrNotApprovable", err)
	}
}
