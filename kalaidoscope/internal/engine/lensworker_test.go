package engine

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbtest"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func init() {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return scriptedProvider{}
	})
}

// scriptedProvider plays a two-candidate, target-isolated distillation: the
// generator's first lens misses, the critic diagnoses it, and the revised lens
// reproduces the target byte-for-byte. Threads are told apart by their system
// prompt; the stateless execute leg has no system turn.
type scriptedProvider struct{}

func (scriptedProvider) ContextWindow() int { return 256_000 }

var (
	scriptMu    sync.Mutex
	genCalls    [][]llm.Message
	criticCalls [][]llm.Message
)

const scriptedDiagnosis = "items should be a single italicized sentence"

func (scriptedProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	var reply string
	switch {
	case msgs[0].Role == "system" && msgs[0].Content == prompts.DistillGenSystem:
		scriptMu.Lock()
		genCalls = append(genCalls, msgs)
		scriptMu.Unlock()
		if len(msgs) == 2 {
			reply = "LENS V1"
		} else {
			reply = "LENS V2"
		}
	case msgs[0].Role == "system" && msgs[0].Content == prompts.DistillCriticSystem:
		scriptMu.Lock()
		criticCalls = append(criticCalls, msgs)
		scriptMu.Unlock()
		reply = "VERDICT: MISMATCH\nSCORE: 40\nDIAGNOSIS: " + scriptedDiagnosis
	default: // stateless production apply
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
	genCalls, criticCalls = nil, nil
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
	// The conversation's context seed, as the refinement handler writes it:
	// the timeline renders this as the initial source state.
	pinnedData, _ := json.Marshal(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}})
	pbtest.NewRecord(t, app, "chat_message", map[string]any{
		"refine_proj_conversation_id": ref.Id,
		"content": pbutil.JSONObject(api.UIMessage{
			ID: "s1", Role: "system",
			Parts: []api.UIMessagePart{{Type: "pinned_ids", Data: pinnedData}},
		}),
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

	scriptMu.Lock()
	genSeen := append([][]llm.Message(nil), genCalls...)
	criticSeen := append([][]llm.Message(nil), criticCalls...)
	scriptMu.Unlock()

	// The generator saw the refinement chat and the sources via the timeline's
	// inline context state — and NEVER the target, in any turn of any call.
	initial := genSeen[0][1].Content
	for _, want := range []string{"make it a haiku", "raw notes"} {
		if !strings.Contains(initial, want) {
			t.Errorf("initial generator message missing %q", want)
		}
	}
	for _, call := range genSeen {
		for _, m := range call {
			if strings.Contains(m.Content, "TARGET OUTPUT") {
				t.Fatalf("generator saw the target in a %s turn", m.Role)
			}
		}
	}

	// The critic is the only holder of the target, and its diagnosis reached
	// the generator's feedback turn.
	if len(criticSeen) != 1 {
		t.Fatalf("critic calls = %d, want 1", len(criticSeen))
	}
	criticInitial := criticSeen[0][1].Content
	for _, want := range []string{"TARGET OUTPUT", "WRONG OUTPUT"} {
		if !strings.Contains(criticInitial, want) {
			t.Errorf("critic's initial message missing %q", want)
		}
	}
	if len(genSeen) != 2 {
		t.Fatalf("generator calls = %d, want 2", len(genSeen))
	}
	feedback := genSeen[1][len(genSeen[1])-1].Content
	if !strings.Contains(feedback, scriptedDiagnosis) {
		t.Errorf("generator feedback turn missing the critic's diagnosis: %q", feedback)
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

// driftFixture seeds a projection whose approved lens was distilled by
// lensModel, with the approved distill-origin snapshot still pointing at it —
// the state the drift scan reads.
func driftFixture(t *testing.T, app core.App, lensModel string) (proj, lens, snap *core.Record) {
	t.Helper()
	frag := pbtest.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "raw notes"})
	spec := api.ContextSpec{WholeScope: true}
	lens = pbtest.NewRecord(t, app, "lens", map[string]any{
		"prompt":       pbutil.JSONString("LENS V2"),
		"context_spec": pbutil.JSONObject(spec),
		"model":        lensModel,
	})
	proj = pbtest.NewRecord(t, app, "projection", map[string]any{
		"name":                 "P",
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
	})
	snap = pbtest.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   StatusApproved,
		"output":                   pbutil.JSONString("TARGET OUTPUT"),
		"context_spec":             pbutil.JSONObject(spec),
		"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
		"lens_id":                  lens.Id,
		"lens_distill_requested":   true,
		"approval_sequence_number": 1,
		"approval_timestamp":       "2026-08-01 10:00:00.000Z",
	})
	return proj, lens, snap
}

func withEngineWorkspaceConfig(t *testing.T, cfg llm.WorkspaceConfig) {
	t.Helper()
	prev := llm.ActiveWorkspaceConfig()
	llm.SetWorkspaceConfig(cfg)
	t.Cleanup(func() { llm.SetWorkspaceConfig(prev) })
}

func TestDriftScanRedistillsWhenDefaultModelMoves(t *testing.T) {
	app := pbtest.NewApp(t)
	proj, oldLens, snap := driftFixture(t, app, "old-model")
	withEngineWorkspaceConfig(t, llm.WorkspaceConfig{
		Provider:     llm.ProviderGemini,
		DefaultModel: "new-model",
	})

	runDistillPass(app)

	proj, _ = app.FindRecordById("projection", proj.Id)
	newLensID := proj.GetString("current_lens_id")
	if newLensID == "" || newLensID == oldLens.Id {
		t.Fatalf("current_lens_id = %q, want a replacement lens", newLensID)
	}
	newLens, err := app.FindRecordById("lens", newLensID)
	if err != nil {
		t.Fatal(err)
	}
	if got := newLens.GetString("model"); got != "new-model" {
		t.Fatalf("replacement lens model = %q, want %q", got, "new-model")
	}
	if got := newLens.GetString("parent_lens_id"); got != oldLens.Id {
		t.Fatalf("parent_lens_id = %q, want the drifted lens %q", got, oldLens.Id)
	}
	// Lazy: the previously approved snapshot's output was never touched; only
	// its lens_id follows the replacement so the association survives.
	snap, _ = app.FindRecordById("projection_snapshot", snap.Id)
	if got := pbutil.DecodeJSONString(snap.GetString("output")); got != "TARGET OUTPUT" {
		t.Fatalf("approved snapshot output changed to %q", got)
	}
	if got := snap.GetString("lens_id"); got != newLensID {
		t.Fatalf("snapshot lens_id = %q, want re-pointed to %q", got, newLensID)
	}

	// Convergence: the replacement's model matches the effective model, so a
	// second pass finds no drift and mints nothing.
	runDistillPass(app)
	lenses, err := app.FindRecordsByFilter("lens", "id != ''", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(lenses) != 2 {
		t.Fatalf("lens count after second pass = %d, want 2 (old + one replacement)", len(lenses))
	}
}

func TestDriftScanHonoursEntityOverride(t *testing.T) {
	app := pbtest.NewApp(t)
	proj, _, _ := driftFixture(t, app, "gemma4")
	// The workspace still resolves to gemma4 (static local set); only the
	// entity's own override moves.
	proj.Set("model", "override-model")
	if err := app.Save(proj); err != nil {
		t.Fatal(err)
	}

	runDistillPass(app)

	proj, _ = app.FindRecordById("projection", proj.Id)
	newLens, err := app.FindRecordById("lens", proj.GetString("current_lens_id"))
	if err != nil {
		t.Fatal(err)
	}
	if got := newLens.GetString("model"); got != "override-model" {
		t.Fatalf("replacement lens model = %q, want the entity override", got)
	}
}

func TestDriftScanSkipsPreProvenanceLens(t *testing.T) {
	app := pbtest.NewApp(t)
	proj, oldLens, _ := driftFixture(t, app, "")
	withEngineWorkspaceConfig(t, llm.WorkspaceConfig{
		Provider:     llm.ProviderGemini,
		DefaultModel: "new-model",
	})

	runDistillPass(app)

	proj, _ = app.FindRecordById("projection", proj.Id)
	if got := proj.GetString("current_lens_id"); got != oldLens.Id {
		t.Fatalf("pre-provenance lens was replaced (current_lens_id = %q)", got)
	}
}
