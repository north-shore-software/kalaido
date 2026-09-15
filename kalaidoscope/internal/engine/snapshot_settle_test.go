package engine

import (
	"context"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func speculative(ctx context.Context) context.Context {
	return llmcontext.WithGenerationTrigger(ctx, llmcontext.TriggerGenerateAll)
}

func allSnapshots(t *testing.T, app core.App, strat Strategy, parentID string) []*core.Record {
	t.Helper()
	recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
		strat.ForeignKeyCol()+" = {:id}", "-created", 0, 0, dbx.Params{"id": parentID})
	if err != nil {
		t.Fatal(err)
	}
	return recs
}

// A speculative regeneration that reproduces the approved output byte for
// byte does not park a candidate: the approved row records the context it
// now reflects, and nothing else is written.
func TestGenerateSnapshotSpeculativeByteEqualSettlesInPlace(t *testing.T) {
	app := testutil.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)
	approvedID := allSnapshots(t, app, strat, proj.Id)[0].Id

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		return "OLD V1", nil
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(speculative(context.Background()), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	if snapID != approvedID {
		t.Errorf("returned %s, want the approved snapshot %s", snapID, approvedID)
	}
	rows := allSnapshots(t, app, strat, proj.Id)
	if len(rows) != 1 {
		t.Fatalf("snapshot rows = %d, want 1 (no candidate, claim released)", len(rows))
	}
	if rows[0].GetString("status") != StatusApproved {
		t.Errorf("status = %q, want approved", rows[0].GetString("status"))
	}
	var recorded llmcontext.PinnedIDs
	_ = rows[0].UnmarshalJSONField("resolved_context", &recorded)
	if len(recorded.FragmentIDs) != 1 {
		t.Errorf("approved snapshot resolved_context = %+v, want the fixture fragment recorded", recorded)
	}
	if n := len(script.transcripts()); n != 1 {
		t.Errorf("model calls = %d, want 1 (no delta conversation for a byte-equal candidate)", n)
	}
	if !SnapshotIsCurrent(speculative(context.Background()), app, strat, proj) {
		t.Error("entity still reads as not current after settling in place")
	}
}

// The same when the delta conversation is what finds no semantic change.
func TestGenerateSnapshotSpeculativeNoSemanticChangeSettlesInPlace(t *testing.T) {
	app := testutil.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		if len(msgs) == 1 {
			return "REWORDED V1", nil
		}
		return prompts.SnapshotNoChanges, nil
	}}
	script.install(t)

	if _, err := GenerateSnapshot(speculative(context.Background()), app, proj.Id, StatusPending, strat, nil); err != nil {
		t.Fatal(err)
	}
	rows := allSnapshots(t, app, strat, proj.Id)
	if len(rows) != 1 || rows[0].GetString("status") != StatusApproved {
		t.Fatalf("rows = %d, want the single approved row settled in place", len(rows))
	}
	if got := rows[0].GetString("output"); got != "OLD V1" {
		t.Errorf("approved output = %q, want untouched", got)
	}
}

// A speculative no-change also supersedes an older pending candidate: the
// entity is current, so there is nothing left to review.
func TestGenerateSnapshotSpeculativeNoChangeDiscardsStalePending(t *testing.T) {
	app := testutil.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)
	stale := testutil.NewRecord(t, app, strat.SnapshotCollectionName(), map[string]any{
		strat.ForeignKeyCol(): proj.Id,
		"lens_id":             proj.GetString("current_lens_id"),
		"output":              "OLDER CANDIDATE",
		"status":              StatusPending,
	})

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		return "OLD V1", nil
	}}
	script.install(t)

	if _, err := GenerateSnapshot(speculative(context.Background()), app, proj.Id, StatusPending, strat, nil); err != nil {
		t.Fatal(err)
	}
	rec, err := app.FindRecordById(strat.SnapshotCollectionName(), stale.Id)
	if err != nil {
		t.Fatal(err)
	}
	if rec.GetString("status") != StatusDiscarded {
		t.Errorf("older candidate status = %q, want discarded", rec.GetString("status"))
	}
}

// An interactive regeneration keeps today's behaviour: the user asked to see
// the result, so an identical candidate is still parked for review.
func TestGenerateSnapshotInteractiveNoChangeStillParksCandidate(t *testing.T) {
	app := testutil.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		return "OLD V1", nil
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	rec, err := app.FindRecordById(strat.SnapshotCollectionName(), snapID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.GetString("status") != StatusPending {
		t.Errorf("interactive no-change status = %q, want pending_review", rec.GetString("status"))
	}
}
