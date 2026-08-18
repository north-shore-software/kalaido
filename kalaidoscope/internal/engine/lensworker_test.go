package engine

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func init() {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return scriptedProvider{}
	})
}

// scriptedProvider plays a two-candidate distillation: the initial generation
// yields LENS V1, whose execution misses the target; the critique revises it to
// LENS V2, whose execution reproduces the target byte-for-byte.
type scriptedProvider struct{}

var (
	scriptMu       sync.Mutex
	optimizerCalls [][]llm.Message
)

func (scriptedProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	var reply string
	if msgs[0].Role == "system" { // optimizer conversation
		scriptMu.Lock()
		optimizerCalls = append(optimizerCalls, msgs)
		scriptMu.Unlock()
		if len(msgs) == 2 {
			reply = "LENS V1"
		} else {
			reply = "VERDICT: MISMATCH\nSCORE: 40\nDIAGNOSIS: wrong structure\nREVISED LENS:\nLENS V2"
		}
	} else { // stateless production apply
		if strings.Contains(msgs[0].Content, "LENS V2") {
			reply = "TARGET OUTPUT"
		} else {
			reply = "WRONG OUTPUT"
		}
	}
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: reply}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

func TestDistillPassRunsLoopFromDBState(t *testing.T) {
	app := pbtest.NewApp(t)
	scriptMu.Lock()
	optimizerCalls = nil
	scriptMu.Unlock()

	frag := pbtest.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	proj := pbtest.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P",
		"current_context_spec": pbutil.JSONObject(spec),
	})
	ref := pbtest.NewRecord(t, app, "refine_proj_snapshot_conversation", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "ext-1",
	})
	pbtest.NewRecord(t, app, "chat_message", map[string]any{
		"refine_proj_conversation_id": ref.Id,
		"content": pbutil.JSONObject(api.UIMessage{
			ID: "m1", Role: "user",
			Parts: []api.UIMessagePart{{Type: "text", Text: "make it a haiku"}},
		}),
	})
	snap := pbtest.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":              proj.Id,
		"status":                     StatusApproved,
		"output":                     pbutil.JSONString("TARGET OUTPUT"),
		"context_spec":               pbutil.JSONObject(spec),
		"resolved_context":           pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
		"created_from_refinement_id": ref.Id,
		"lens_distill_requested":     true,
		"approval_sequence_number":   1,
	})

	// The worklist is derived from DB state alone — no enqueue happened.
	runDistillPass(app)

	proj, err := app.FindRecordById("projection", proj.Id)
	if err != nil {
		t.Fatal(err)
	}
	lensID := proj.GetString("current_lens_id")
	if lensID == "" {
		t.Fatal("projection has no current_lens_id after pass")
	}
	lens, err := app.FindRecordById("lens", lensID)
	if err != nil {
		t.Fatal(err)
	}
	if got := pbutil.DecodeJSONString(lens.GetString("prompt")); got != "LENS V2" {
		t.Fatalf("lens prompt = %q, want LENS V2", got)
	}
	if got := lens.GetInt("iterations"); got != 2 {
		t.Fatalf("iterations = %d, want 2", got)
	}
	if !lens.GetBool("converged") {
		t.Fatal("converged = false, want true")
	}
	if got := lens.GetString("created_from_proj_refinement_id"); got != ref.Id {
		t.Fatalf("created_from_proj_refinement_id = %q, want %q", got, ref.Id)
	}
	if got := lens.GetString("parent_lens_id"); got != "" {
		t.Fatalf("parent_lens_id = %q, want empty (no previous lens)", got)
	}
	if got := lens.GetString("model"); got != "gemma4" {
		t.Fatalf("model = %q, want the snapshot role's model (same-model hard rule)", got)
	}

	snap, err = app.FindRecordById("projection_snapshot", snap.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("lens_id"); got != lensID {
		t.Fatalf("snapshot lens_id = %q, want %q", got, lensID)
	}

	// The optimizer saw the refinement chat and the target; never a previous lens.
	scriptMu.Lock()
	initial := optimizerCalls[0][1].Content
	scriptMu.Unlock()
	for _, want := range []string{"make it a haiku", "TARGET OUTPUT", "raw notes"} {
		if !strings.Contains(initial, want) {
			t.Errorf("initial optimizer message missing %q", want)
		}
	}

	// A second pass finds nothing: lens_id is set, so the worklist is empty.
	runDistillPass(app)
	lenses, err := app.FindRecordsByFilter("lens", "id != ''", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(lenses) != 1 {
		t.Fatalf("lens count after second pass = %d, want 1", len(lenses))
	}
}

func TestDistillPassPicksLatestApprovalPerParent(t *testing.T) {
	app := pbtest.NewApp(t)

	frag := pbtest.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	proj := pbtest.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P",
		"current_context_spec": pbutil.JSONObject(spec),
	})
	newSnap := func(seq int, ts string) *core.Record {
		return pbtest.NewRecord(t, app, "projection_snapshot", map[string]any{
			"projection_id":            proj.Id,
			"status":                   StatusApproved,
			"output":                   pbutil.JSONString("TARGET OUTPUT"),
			"context_spec":             pbutil.JSONObject(spec),
			"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
			"lens_distill_requested":   true,
			"approval_sequence_number": seq,
			"approval_timestamp":       ts,
		})
	}
	superseded := newSnap(1, "2026-08-01 10:00:00.000Z")
	latest := newSnap(2, "2026-08-02 10:00:00.000Z")

	runDistillPass(app)

	superseded, _ = app.FindRecordById("projection_snapshot", superseded.Id)
	latest, _ = app.FindRecordById("projection_snapshot", latest.Id)
	if superseded.GetString("lens_id") != "" {
		t.Fatal("superseded snapshot got a lens; only the latest approval should")
	}
	if latest.GetString("lens_id") == "" {
		t.Fatal("latest approved snapshot did not get a lens")
	}
}
