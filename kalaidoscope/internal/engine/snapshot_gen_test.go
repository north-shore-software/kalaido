package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

// snapshotScript answers the calls of one generation flow and records every
// transcript. The three calls are told apart by transcript length: 1 message
// is the raw apply, 3 the delta turn, 5 the merge turn.
type snapshotScript struct {
	mu    sync.Mutex
	calls [][]llm.Message
	reply func(msgs []llm.Message) (string, error)
}

// install points the provider factory at this script for one test, then hands
// it back to the distillation scriptedProvider the package init registered, so
// the lensworker tests keep their script regardless of execution order.
func (s *snapshotScript) install(t *testing.T) {
	t.Helper()
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return snapshotScriptProvider{s}
	})
	t.Cleanup(func() {
		llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
			return scriptedProvider{}
		})
	})
}

func (s *snapshotScript) transcripts() [][]llm.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([][]llm.Message(nil), s.calls...)
}

type snapshotScriptProvider struct{ s *snapshotScript }

func (p snapshotScriptProvider) ContextWindow() int { return 256_000 }

func (p snapshotScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	p.s.mu.Lock()
	p.s.calls = append(p.s.calls, msgs)
	p.s.mu.Unlock()
	reply, err := p.s.reply(msgs)
	if err != nil {
		return nil, err
	}
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: reply}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

func genFixture(t *testing.T, app core.App, collection string) *core.Record {
	t.Helper()
	pbtest.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	lens := pbtest.NewRecord(t, app, "lens", map[string]any{
		"prompt":       pbutil.JSONString("LENS"),
		"context_spec": pbutil.JSONObject(spec),
	})
	return pbtest.NewRecord(t, app, collection, map[string]any{
		"name":                 "T",
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
	})
}

func priorApproved(t *testing.T, app core.App, strat Strategy, parent *core.Record, output string, extra map[string]any) {
	t.Helper()
	fields := map[string]any{
		strat.ForeignKeyCol():      parent.Id,
		"lens_id":                  parent.GetString("current_lens_id"),
		"output":                   pbutil.JSONString(output),
		"status":                   StatusApproved,
		"approval_sequence_number": 1,
	}
	for k, v := range extra {
		fields[k] = v
	}
	pbtest.NewRecord(t, app, strat.SnapshotCollectionName(), fields)
}

func storedOutput(t *testing.T, app core.App, strat Strategy, snapID string) string {
	t.Helper()
	snap, err := app.FindRecordById(strat.SnapshotCollectionName(), snapID)
	if err != nil {
		t.Fatal(err)
	}
	return pbutil.DecodeJSONString(snap.GetString("output"))
}

// With no approved predecessor the raw candidate is the snapshot — one model
// call, no delta conversation.
func TestGenerateSnapshotFirstGenerationStoresRawCandidate(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		return "RAW OUT", nil
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusApproved, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, strat, snapID); got != "RAW OUT" {
		t.Errorf("output = %q, want the raw candidate", got)
	}
	if n := len(script.transcripts()); n != 1 {
		t.Errorf("model calls = %d, want 1", n)
	}
}

// With an approved predecessor the flow continues the generation conversation
// — delta then merge — and stores the merge result, not the raw candidate.
func TestGenerateSnapshotMinimizesAgainstApproved(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		switch len(msgs) {
		case 1:
			return "RAW V2", nil
		case 3:
			return "- added X", nil
		case 5:
			return "MERGED V2", nil
		}
		return "", fmt.Errorf("unexpected transcript length %d", len(msgs))
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, strat, snapID); got != "MERGED V2" {
		t.Errorf("output = %q, want the merge result", got)
	}

	calls := script.transcripts()
	if len(calls) != 3 {
		t.Fatalf("model calls = %d, want 3", len(calls))
	}
	delta := calls[1]
	if delta[1].Role != "assistant" || delta[1].Content != "RAW V2" {
		t.Errorf("delta turn does not continue from the candidate: %+v", delta[1])
	}
	if !strings.Contains(delta[2].Content, "OLD V1") {
		t.Error("delta prompt does not carry the previous approved output")
	}
	merge := calls[2]
	if merge[3].Content != "- added X" || merge[4].Content != prompts.SnapshotMergePrompt() {
		t.Errorf("merge turn does not continue from the delta: %+v", merge[3:])
	}
}

// A delta of NO CHANGES republishes the previous output verbatim and skips the
// merge call entirely.
func TestGenerateSnapshotNoChangesKeepsPreviousVerbatim(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		if len(msgs) == 1 {
			return "REWORDED V1", nil
		}
		return "  " + prompts.SnapshotNoChanges + "\n", nil
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, strat, snapID); got != "OLD V1" {
		t.Errorf("output = %q, want the previous output verbatim", got)
	}
	if n := len(script.transcripts()); n != 2 {
		t.Errorf("model calls = %d, want 2 (merge skipped)", n)
	}
}

// The polish steps failing must not fail the generation: the raw candidate is
// correct, just noisier to diff.
func TestGenerateSnapshotFallsBackToRawCandidateOnDeltaError(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ProjectionStrategy{}
	proj := genFixture(t, app, "projection")
	priorApproved(t, app, strat, proj, "OLD V1", nil)

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		if len(msgs) == 1 {
			return "RAW V2", nil
		}
		return "", fmt.Errorf("scripted delta failure")
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, proj.Id, StatusPending, strat, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, strat, snapID); got != "RAW V2" {
		t.Errorf("output = %q, want the raw candidate fallback", got)
	}
}

// A reflection's merge base is the approved output of its own window, not
// whichever window was approved last.
func TestGenerateSnapshotReflectionScopesBaseToWindow(t *testing.T) {
	app := pbtest.NewApp(t)
	strat := ReflectionStrategy{}
	refl := genFixture(t, app, "reflection")

	winA := &api.Window{Start: "2026-08-01 00:00:00.000Z", End: "2026-08-08 00:00:00.000Z"}
	winB := &api.Window{Start: "2026-08-08 00:00:00.000Z", End: "2026-08-15 00:00:00.000Z"}
	priorApproved(t, app, strat, refl, "OLD A", map[string]any{
		"window_key":      winA.Start + "_" + winA.End,
		"resolved_window": pbutil.JSONObject(map[string]string{"start": winA.Start, "end": winA.End}),
	})
	priorApproved(t, app, strat, refl, "OLD B", map[string]any{
		"window_key":      winB.Start + "_" + winB.End,
		"resolved_window": pbutil.JSONObject(map[string]string{"start": winB.Start, "end": winB.End}),
	})

	script := &snapshotScript{reply: func(msgs []llm.Message) (string, error) {
		switch len(msgs) {
		case 1:
			return "RAW A2", nil
		case 3:
			return "- window A gained X", nil
		case 5:
			return "MERGED A2", nil
		}
		return "", fmt.Errorf("unexpected transcript length %d", len(msgs))
	}}
	script.install(t)

	snapID, err := GenerateSnapshot(context.Background(), app, refl.Id, StatusApproved, strat, winA)
	if err != nil {
		t.Fatal(err)
	}
	if got := storedOutput(t, app, strat, snapID); got != "MERGED A2" {
		t.Errorf("output = %q, want the merge result", got)
	}

	calls := script.transcripts()
	if len(calls) != 3 {
		t.Fatalf("model calls = %d, want 3", len(calls))
	}
	deltaPrompt := calls[1][2].Content
	if !strings.Contains(deltaPrompt, "OLD A") {
		t.Error("delta prompt does not carry window A's approved output")
	}
	if strings.Contains(deltaPrompt, "OLD B") {
		t.Error("delta prompt leaked another window's output")
	}
}
