package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestProjectionLensGetAndPut(t *testing.T) {
	app := testutil.NewApp(t)
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "Briefed"})

	// Empty lens initially.
	rec, err := callJSON(t, app, HandleGetProjectionLens(app), http.MethodGet,
		"/api/projections/"+proj.Id+"/lens", "", map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("GET lens: %v", err)
	}
	var got api.ProjectionLensResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.LensID != "" || got.Prompt != "" || got.Updating {
		t.Fatalf("initial GET lens = %+v, want empty and updating=false", got)
	}

	// PUT creates first lens and points current_lens_id at it.
	rec, err = callJSON(t, app, HandleUpdateProjectionLens(app), http.MethodPut,
		"/api/projections/"+proj.Id+"/lens", `{"prompt":"Keep it crisp and bulleted."}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("PUT lens 1: %v", err)
	}
	var put1 api.ProjectionLensResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &put1); err != nil {
		t.Fatal(err)
	}
	if put1.LensID == "" || put1.Prompt != "Keep it crisp and bulleted." {
		t.Fatalf("PUT lens 1 = %+v", put1)
	}

	// Second PUT appends a new lens row chained via parent_lens_id.
	rec, err = callJSON(t, app, HandleUpdateProjectionLens(app), http.MethodPut,
		"/api/projections/"+proj.Id+"/lens", `{"prompt":"Use narrative paragraphs."}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("PUT lens 2: %v", err)
	}
	var put2 api.ProjectionLensResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &put2); err != nil {
		t.Fatal(err)
	}
	if put2.LensID == put1.LensID {
		t.Fatalf("expected new lens row id on update")
	}
	lensRec, err := app.FindRecordById(schema.ColLens.String(), put2.LensID)
	if err != nil {
		t.Fatal(err)
	}
	if lensRec.GetString("parent_lens_id") != put1.LensID {
		t.Errorf("parent_lens_id = %q, want %q", lensRec.GetString("parent_lens_id"), put1.LensID)
	}

	// Empty prompt rejected with 400.
	_, err = callJSON(t, app, HandleUpdateProjectionLens(app), http.MethodPut,
		"/api/projections/"+proj.Id+"/lens", `{"prompt":"   "}`, map[string]string{"id": proj.Id})
	if code := apiErrorStatus(err); code != http.StatusBadRequest {
		t.Errorf("empty prompt status = %d, want 400", code)
	}
}

func TestProjectionReviseAndDiscardRoutes(t *testing.T) {
	app := testutil.NewApp(t)
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "Notes",
		"status":               engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
	})
	// No approved snapshot yet -> 409.
	_, err := callJSON(t, app, HandleStartProjectionRevise(app), http.MethodPost,
		"/api/projections/"+proj.Id+"/sessions/revise", `{}`, map[string]string{"id": proj.Id})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Fatalf("revise without approved snapshot status = %d, want 409", code)
	}

	approved := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"output":                   "Live body",
		"context_spec":             pbutil.JSONObject(spec),
	})

	rec, err := callJSON(t, app, HandleStartProjectionRevise(app), http.MethodPost,
		"/api/projections/"+proj.Id+"/sessions/revise", `{}`, map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("revise: %v", err)
	}
	var res api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.SnapshotID == "" || res.RefinementID == "" {
		t.Fatalf("revise response = %+v", res)
	}

	cand, err := app.FindRecordById(schema.ColProjectionSnapshot.String(), res.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if cand.GetString("status") != engine.StatusPending || cand.GetString("output_draft") != "Live body" {
		t.Fatalf("cand = status=%q draft=%q", cand.GetString("status"), cand.GetString("output_draft"))
	}

	// Discard closes the pending candidate without touching approved snapshot.
	_, err = callJSON(t, app, HandleDiscardCandidate(app), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates/"+res.SnapshotID+"/discard", `{}`,
		map[string]string{"id": proj.Id, "rid": res.SnapshotID})
	if err != nil {
		t.Fatalf("discard: %v", err)
	}
	cand, _ = app.FindRecordById(schema.ColProjectionSnapshot.String(), res.SnapshotID)
	if cand.GetString("status") != engine.StatusDiscarded {
		t.Errorf("status after discard = %q, want discarded", cand.GetString("status"))
	}
	live, _ := app.FindRecordById(schema.ColProjectionSnapshot.String(), approved.Id)
	if live.GetString("status") != engine.StatusApproved {
		t.Errorf("approved snapshot status changed to %q", live.GetString("status"))
	}
}

func TestResolveAllSnapshotEditsRoute(t *testing.T) {
	app := testutil.NewApp(t)
	proj, src := editHandlerFixture(t, app)
	draft, edits := engine.DiffAndMarkBlocks("A\n\nB\n\nC", "A1\n\nB\n\nC1", api.EditTypeRegeneration)
	if len(edits) != 2 {
		t.Fatalf("expected 2 diff hunks, got %d", len(edits))
	}
	src.Set("output_draft", draft)
	src.Set("edits", pbutil.JSONObject(edits))
	if err := app.Save(src); err != nil {
		t.Fatal(err)
	}

	path := "/api/projections/" + proj.Id + "/candidates/" + src.Id + "/edits/resolve-all"
	rec, err := callJSON(t, app, HandleResolveAllSnapshotEdits(app), http.MethodPost, path,
		`{"status":"approved"}`, map[string]string{"id": proj.Id, "rid": src.Id})
	if err != nil {
		t.Fatalf("resolve-all approved: %v", err)
	}
	var res api.ResolveAllSnapshotEditsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	for _, e := range res.Edits {
		if e.Status != api.EditStatusApproved {
			t.Errorf("edit %s status = %q, want approved", e.ID, e.Status)
		}
	}
	snap, _ := app.FindRecordById(schema.ColProjectionSnapshot.String(), src.Id)
	if got := snap.GetString("output_draft"); got != "A1\n\nB\n\nC1" {
		t.Errorf("output_draft = %q, want %q", got, "A1\n\nB\n\nC1")
	}
}

// Unified Save distills the living editorial brief asynchronously and respects
// the optimistic concurrency guard so concurrent manual PUT .../lens edits are
// never clobbered.
func TestSaveDistillsBriefAndRespectsOptimisticConcurrencyGuard(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{reply: "Distilled standing brief from session."}
	})
	app := testutil.NewApp(t)
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":   "Roadmap",
		"status": engine.EntityProposed,
	})
	cand := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "# Q4 Roadmap\n\nShip Stage 1.",
		"context_spec":  pbutil.JSONObject(spec),
	})

	// 1. Save with InlineRunner distills the first brief and activates projection.
	rec, err := callJSON(t, app, HandleApproveCandidate(app, workerutil.InlineRunner{}), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates/"+cand.Id+"/approve", `{}`,
		map[string]string{"id": proj.Id, "rid": cand.Id})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	proj, _ = app.FindRecordById(schema.ColProjection.String(), proj.Id)
	if proj.GetString("status") != engine.EntityActive {
		t.Errorf("projection status = %q, want active", proj.GetString("status"))
	}
	lensResp, err := projections.ReadLens(app, proj.Id)
	if err != nil {
		t.Fatal(err)
	}
	if lensResp.Prompt != "Distilled standing brief from session." {
		t.Fatalf("distilled brief = %q, want distilled text", lensResp.Prompt)
	}

	// 2. Optimistic concurrency guard: if the user manually updates the lens
	// while a distillation job is in flight (captured previousLensID is stale),
	// DistillLivingBrief must NOT clobber the manual edit.
	prevLensID := lensResp.LensID
	manual, err := projections.UpdateLens(app, proj.Id, "Human-edited brief that must win.")
	if err != nil {
		t.Fatal(err)
	}
	if err := projections.DistillLivingBrief(context.Background(), app, projections.DistillBriefParams{
		ProjectionID:        proj.Id,
		PreviousLensID:      prevLensID, // stale!
		FinalSnapshotOutput: "# Q4 Roadmap\n\nUpdated.",
	}); err != nil {
		t.Fatalf("DistillLivingBrief: %v", err)
	}
	after, _ := projections.ReadLens(app, proj.Id)
	if after.LensID != manual.LensID || after.Prompt != "Human-edited brief that must win." {
		t.Fatalf("optimistic guard failed: got %+v, want manual lens %+v", after, manual)
	}
}

type projectionChatScript struct {
	mu          sync.Mutex
	calls       int
	seenSystems []string
	seenTools   [][]string
	onCall      func(call int, msgs []llm.Message, tools []llm.Tool) ([]llm.StreamEvent, error)
}

func (s *projectionChatScript) install(t *testing.T) {
	t.Helper()
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return projectionChatScriptProvider{s}
	})
}

type projectionChatScriptProvider struct{ s *projectionChatScript }

func (projectionChatScriptProvider) ContextWindow() int { return 256_000 }

func (p projectionChatScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	p.s.mu.Lock()
	p.s.calls++
	n := p.s.calls
	if len(msgs) > 0 {
		p.s.seenSystems = append(p.s.seenSystems, msgs[0].Content)
	}
	toolNames := make([]string, len(tools))
	for i, tool := range tools {
		toolNames[i] = tool.Name
	}
	p.s.seenTools = append(p.s.seenTools, toolNames)
	fn := p.s.onCall
	p.s.mu.Unlock()

	evs, err := fn(n, msgs, tools)
	if err != nil {
		return nil, err
	}
	ch := make(chan llm.StreamEvent, len(evs))
	for _, ev := range evs {
		ch <- ev
	}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

func runProjectionChat(t *testing.T, app core.App, refRec *core.Record, msgs []api.UIMessage) string {
	t.Helper()
	req := api.ChatRequest{
		ID:       refRec.GetString("external_conversation_id"),
		Messages: msgs,
	}
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/projections/"+refRec.GetString("projection_id")+"/refinements/"+refRec.Id+"/chat", nil)
	e.Response = rec
	if err := HandleProjectionChatForRefinement(app, req, refRec)(e); err != nil {
		t.Fatalf("projection chat: %v", err)
	}
	return rec.Body.String()
}

func TestProjectionCanvasChatWriteProposeUpdateAndPickerNotify(t *testing.T) {
	app := testutil.NewApp(t)
	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "Untitled projection"})
	ref := testutil.NewRecord(t, app, "projection_refinement", map[string]any{
		"projection_id":            proj.Id,
		"external_conversation_id": "proj-chat-1",
	})

	script := &projectionChatScript{
		onCall: func(call int, msgs []llm.Message, tools []llm.Tool) ([]llm.StreamEvent, error) {
			switch call {
			case 1:
				// Initial turn: write_draft + suggest_name (no CompileLens, no preview lens rows).
				wdArgs, _ := json.Marshal(prompts.WriteDraftArgs{Content: "Para 1\n\nPara 2\n\nPara 3"})
				snArgs, _ := json.Marshal(map[string]string{"name": "Checkout PRD"})
				return []llm.StreamEvent{
					{Kind: llm.EventText, Text: "Here is your initial draft."},
					{Kind: llm.EventToolStart, ToolCallID: "tc-n", ToolName: prompts.SuggestNameToolName},
					{Kind: llm.EventToolEnd, ToolCallID: "tc-n", ToolName: prompts.SuggestNameToolName, Args: snArgs},
					{Kind: llm.EventToolStart, ToolCallID: "tc-w", ToolName: prompts.WriteDraftToolName},
					{Kind: llm.EventToolEnd, ToolCallID: "tc-w", ToolName: prompts.WriteDraftToolName, Args: wdArgs},
				}, nil
			case 2:
				// Second turn: picker changed context (no user message) -> conversational reply with 0 tools!
				return []llm.StreamEvent{
					{Kind: llm.EventText, Text: "Got it — I see the updated context. Would you like me to update the draft now?"},
				}, nil
			case 3:
				// Third turn: propose_edit on Para 2.
				peArgs, _ := json.Marshal(prompts.ProposeEditArgs{Target: "Para 2", Replacement: "Para 2 revised"})
				return []llm.StreamEvent{
					{Kind: llm.EventText, Text: "Proposed an edit to paragraph 2."},
					{Kind: llm.EventToolStart, ToolCallID: "tc-p", ToolName: prompts.ProposeEditToolName},
					{Kind: llm.EventToolEnd, ToolCallID: "tc-p", ToolName: prompts.ProposeEditToolName, Args: peArgs},
				}, nil
			case 4:
				// Fourth turn: update_draft calling anchored rewrite (call 5) that changes >60% blocks.
				udArgs, _ := json.Marshal(prompts.UpdateDraftArgs{Instructions: "Rewrite everything."})
				return []llm.StreamEvent{
					{Kind: llm.EventToolStart, ToolCallID: "tc-u", ToolName: prompts.UpdateDraftToolName},
					{Kind: llm.EventToolEnd, ToolCallID: "tc-u", ToolName: prompts.UpdateDraftToolName, Args: udArgs},
				}, nil
			case 5:
				// Anchored rewrite LLM call returning completely rewritten 3 blocks (>60% changed).
				return []llm.StreamEvent{
					{Kind: llm.EventText, Text: "Fresh 1\n\nFresh 2\n\nFresh 3"},
				}, nil
			default:
				return []llm.StreamEvent{{Kind: llm.EventText, Text: "ok"}}, nil
			}
		},
	}
	script.install(t)

	// Turn 1: initial write_draft + suggest_name.
	runProjectionChat(t, app, ref, []api.UIMessage{{
		ID:    "u1",
		Role:  "user",
		Parts: []api.UIMessagePart{{Type: "text", Text: "Draft a PRD"}},
	}})

	// Reload ref & projection; verify candidate materialized, projection renamed, ZERO lens rows created.
	ref, _ = app.FindRecordById(schema.ColProjectionRefinement.String(), ref.Id)
	snapID := ref.GetString("projection_snapshot_id")
	if snapID == "" {
		t.Fatal("expected write_draft to create and bind pending candidate")
	}
	snap, _ := app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
	if snap.GetString("output_draft") != "Para 1\n\nPara 2\n\nPara 3" {
		t.Fatalf("draft = %q", snap.GetString("output_draft"))
	}
	proj, _ = app.FindRecordById(schema.ColProjection.String(), proj.Id)
	if proj.GetString("name") != "Checkout PRD" {
		t.Errorf("name = %q, want Checkout PRD", proj.GetString("name"))
	}
	lenses, _ := app.FindRecordsByFilter(schema.ColLens.String(), "id != ''", "", 0, 0, nil)
	if len(lenses) != 0 {
		t.Errorf("mid-session lens rows = %d, want 0", len(lenses))
	}

	// Turn 2: mid-session picker context change (no user turn) -> AI responds conversationally with 0 tools.
	specData, _ := json.Marshal(api.ContextSpec{WholeScope: api.WholeScopeFull})
	body := runProjectionChat(t, app, ref, []api.UIMessage{{
		ID:    "sys-ctx-1",
		Role:  "system",
		Parts: []api.UIMessagePart{{Type: "context_spec", Data: specData}},
	}})
	if !strings.Contains(body, "Would you like me to update the draft now?") {
		t.Fatalf("expected conversational acknowledgement on picker change, got: %s", body)
	}
	if len(script.seenTools[1]) != 0 {
		t.Errorf("picker acknowledgement advertised tools %v, want none", script.seenTools[1])
	}

	// Turn 3: propose_edit — verify system prompt injected live draft freshly.
	runProjectionChat(t, app, ref, []api.UIMessage{{
		ID:    "u2",
		Role:  "user",
		Parts: []api.UIMessagePart{{Type: "text", Text: "Revise para 2"}},
	}})
	if !strings.Contains(script.seenSystems[2], "Para 1\n\nPara 2\n\nPara 3") {
		t.Errorf("system prompt on turn 3 did not include live draft")
	}
	snap, _ = app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
	if !engine.HasUnresolvedEditMarkers(snap.GetString("output_draft")) {
		t.Fatal("expected propose_edit to place unresolved edit marker in output_draft")
	}

	// Turn 4: update_draft triggering >60% full-body replacement confirmation gate.
	body = runProjectionChat(t, app, ref, []api.UIMessage{{
		ID:    "u3",
		Role:  "user",
		Parts: []api.UIMessagePart{{Type: "text", Text: "Rewrite the whole thing"}},
	}})
	if !strings.Contains(body, prompts.FullRewriteConfirmationPartType) {
		t.Fatalf("expected full_rewrite_confirmation card in SSE, got: %s", body)
	}

	// Turn 5: user confirms full rewrite -> applies proposedContent cleanly with zero extra LLM calls.
	callsBefore := script.calls
	runProjectionChat(t, app, ref, []api.UIMessage{{
		ID:    "sys-confirm-rw",
		Role:  "system",
		Parts: []api.UIMessagePart{{Type: prompts.FullRewriteConfirmPartType}},
	}})
	if script.calls != callsBefore {
		t.Errorf("expected confirmed rewrite with proposedContent to avoid extra LLM call, calls went %d -> %d", callsBefore, script.calls)
	}
	snap, _ = app.FindRecordById(schema.ColProjectionSnapshot.String(), snapID)
	if snap.GetString("output_draft") != "Fresh 1\n\nFresh 2\n\nFresh 3" {
		t.Errorf("output_draft after confirm = %q, want Fresh 1..3", snap.GetString("output_draft"))
	}
	if engine.HasUnresolvedEditMarkers(snap.GetString("output_draft")) {
		t.Error("expected clean draft with zero unresolved markers after confirmed full rewrite")
	}
}

type deferredRunner struct {
	mu   sync.Mutex
	jobs []func(context.Context)
}

func (r *deferredRunner) Go(fn func(context.Context)) {
	r.mu.Lock()
	r.jobs = append(r.jobs, fn)
	r.mu.Unlock()
}

func (r *deferredRunner) runAll() {
	r.mu.Lock()
	jobs := append([]func(context.Context){}, r.jobs...)
	r.jobs = nil
	r.mu.Unlock()
	for _, fn := range jobs {
		fn(context.Background())
	}
}

type failingProvider struct{ err error }

func (failingProvider) ContextWindow() int { return 256_000 }
func (p failingProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	return nil, p.err
}

func TestAsyncUpdateClaimDiscardExistingAndStatusRoute(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{reply: "<summary>Updated paragraph 2.</summary>\n<document>P1\n\nP2 updated\n\nP3</document>"}
	})
	app := testutil.NewApp(t)
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	proj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                 "Async Doc",
		"status":               engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
	})
	testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id":            proj.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"output":                   "P1\n\nP2\n\nP3",
		"context_spec":             pbutil.JSONObject(spec),
	})
	oldPending := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": proj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "Stale draft",
	})

	runner := &deferredRunner{}
	rec, err := callJSON(t, app, HandleGenerateCandidate(app, runner), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates",
		`{"preview":true,"async":true,"discardExisting":true}`,
		map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("async generate: %v", err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body %s", rec.Code, rec.Body.String())
	}
	var res api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.SnapshotID == "" {
		t.Fatal("expected immediate claim snapshotId")
	}

	// Old pending candidate was discarded immediately on claim.
	oldPending, _ = app.FindRecordById(schema.ColProjectionSnapshot.String(), oldPending.Id)
	if oldPending.GetString("status") != engine.StatusDiscarded {
		t.Errorf("old pending status = %q, want discarded", oldPending.GetString("status"))
	}

	// Status route reports "generating" before background job finishes.
	stRec, err := callJSON(t, app, HandleGetCandidateStatus(app), http.MethodGet,
		"/api/projections/"+proj.Id+"/candidates/"+res.SnapshotID+"/status", "",
		map[string]string{"id": proj.Id, "rid": res.SnapshotID})
	if err != nil {
		t.Fatalf("status generating: %v", err)
	}
	var st api.ProjectionCandidateStatusResponse
	if err := json.Unmarshal(stRec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Status != "generating" {
		t.Fatalf("status before run = %+v, want generating", st)
	}

	// Execute background job -> snapshot transitions to pending_review + refinement attached.
	runner.runAll()

	stRec, err = callJSON(t, app, HandleGetCandidateStatus(app), http.MethodGet,
		"/api/projections/"+proj.Id+"/candidates/"+res.SnapshotID+"/status", "",
		map[string]string{"id": proj.Id, "rid": res.SnapshotID})
	if err != nil {
		t.Fatalf("status ready: %v", err)
	}
	if err := json.Unmarshal(stRec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Status != "ready" {
		t.Fatalf("status after run = %+v, want ready", st)
	}
	refs, err := app.FindRecordsByFilter(schema.ColProjectionRefinement.String(),
		"projection_snapshot_id = {:sid}", "", 0, 0, map[string]any{"sid": res.SnapshotID})
	if err != nil || len(refs) != 1 {
		t.Fatalf("expected 1 attached refinement, got %d (err=%v)", len(refs), err)
	}
	msgs, _ := chat.LoadMessages(context.Background(), app, refs[0])
	if len(msgs) < 2 {
		t.Fatalf("expected system context + opening assistant message, got %d", len(msgs))
	}

	// Error case: provider failure records error status and releases claim row.
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return failingProvider{err: errors.New("provider boom")}
	})
	rec2, err := callJSON(t, app, HandleGenerateCandidate(app, runner), http.MethodPost,
		"/api/projections/"+proj.Id+"/candidates",
		`{"preview":true,"async":true,"discardExisting":true}`,
		map[string]string{"id": proj.Id})
	if err != nil {
		t.Fatalf("async generate 2: %v", err)
	}
	var res2 api.ProjectionSnapshotResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &res2); err != nil {
		t.Fatal(err)
	}
	runner.runAll()

	if _, findErr := app.FindRecordById(schema.ColProjectionSnapshot.String(), res2.SnapshotID); findErr == nil {
		t.Fatal("expected failed claim row to be released")
	}
	stRec2, err := callJSON(t, app, HandleGetCandidateStatus(app), http.MethodGet,
		"/api/projections/"+proj.Id+"/candidates/"+res2.SnapshotID+"/status", "",
		map[string]string{"id": proj.Id, "rid": res2.SnapshotID})
	if err != nil {
		t.Fatalf("status error: %v", err)
	}
	var st2 api.ProjectionCandidateStatusResponse
	if err := json.Unmarshal(stRec2.Body.Bytes(), &st2); err != nil {
		t.Fatal(err)
	}
	if st2.Status != "error" || !strings.Contains(st2.Error, "provider boom") {
		t.Fatalf("status after failure = %+v, want error containing provider boom", st2)
	}
}

func TestUnifiedDraftDiscardLifecycle(t *testing.T) {
	app := testutil.NewApp(t)

	// 1. Never-saved user-created projection with pending candidate -> hard-deleted.
	userProj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":   "Unsaved User Draft",
		"status": engine.EntityActive,
	})
	userCand := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": userProj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "Draft body",
	})
	userRef := testutil.NewRecord(t, app, "projection_refinement", map[string]any{
		"projection_id":            userProj.Id,
		"projection_snapshot_id":   userCand.Id,
		"external_conversation_id": "conv-user-cand",
	})

	rec, err := callJSON(t, app, HandleDiscardCandidate(app), http.MethodPost,
		"/api/projections/"+userProj.Id+"/candidates/"+userCand.Id+"/discard", `{}`,
		map[string]string{"id": userProj.Id, "rid": userCand.Id})
	if err != nil {
		t.Fatalf("discard never-saved user candidate: %v", err)
	}
	var d1 api.DiscardProjectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &d1); err != nil {
		t.Fatal(err)
	}
	if !d1.DeletedProjection || d1.RevertedToProposed {
		t.Fatalf("discard response = %+v, want deletedProjection=true", d1)
	}
	if _, err := app.FindRecordById(schema.ColProjection.String(), userProj.Id); err == nil {
		t.Fatal("expected user-created never-saved projection to be hard-deleted")
	}
	if _, err := app.FindRecordById(schema.ColProjectionRefinement.String(), userRef.Id); err == nil {
		t.Fatal("expected cascaded delete of refinement row")
	}

	// 2. Discover-originated never-saved projection -> reverted to "proposed".
	run := testutil.NewRecord(t, app, "discover_run", map[string]any{
		"status": "done",
		"kind":   "projections",
	})
	discProj := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":                       "Discovered Proposal",
		"status":                     engine.EntityActive,
		"created_by_discover_run_id": run.Id,
	})
	discCand := testutil.NewRecord(t, app, "projection_snapshot", map[string]any{
		"projection_id": discProj.Id,
		"status":        engine.StatusPending,
		"output_draft":  "Draft from proposal",
	})
	discUnbound := testutil.NewRecord(t, app, "projection_refinement", map[string]any{
		"projection_id":            discProj.Id,
		"external_conversation_id": "conv-disc-unbound",
	})

	rec, err = callJSON(t, app, HandleDiscardCandidate(app), http.MethodPost,
		"/api/projections/"+discProj.Id+"/candidates/"+discCand.Id+"/discard", `{}`,
		map[string]string{"id": discProj.Id, "rid": discCand.Id})
	if err != nil {
		t.Fatalf("discard discover candidate: %v", err)
	}
	var d2 api.DiscardProjectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &d2); err != nil {
		t.Fatal(err)
	}
	if d2.DeletedProjection || !d2.RevertedToProposed {
		t.Fatalf("discard discover response = %+v, want revertedToProposed=true", d2)
	}
	discProj, err = app.FindRecordById(schema.ColProjection.String(), discProj.Id)
	if err != nil {
		t.Fatalf("discover projection should still exist: %v", err)
	}
	if discProj.GetString("status") != engine.EntityProposed {
		t.Errorf("discover projection status = %q, want proposed", discProj.GetString("status"))
	}
	discCand, _ = app.FindRecordById(schema.ColProjectionSnapshot.String(), discCand.Id)
	if discCand.GetString("status") != engine.StatusDiscarded {
		t.Errorf("discover candidate status = %q, want discarded", discCand.GetString("status"))
	}
	if _, err := app.FindRecordById(schema.ColProjectionRefinement.String(), discUnbound.Id); err == nil {
		t.Error("expected unbound refinement on discover projection to be deleted")
	}

	// 3. Unbound draft session (no snapshot row yet) via POST .../draft/discard.
	unboundUser := testutil.NewRecord(t, app, "projection", map[string]any{
		"name":   "Unbound User",
		"status": engine.EntityActive,
	})
	testutil.NewRecord(t, app, "projection_refinement", map[string]any{
		"projection_id":            unboundUser.Id,
		"external_conversation_id": "conv-unbound-user",
	})
	rec, err = callJSON(t, app, HandleDiscardProjectionDraft(app), http.MethodPost,
		"/api/projections/"+unboundUser.Id+"/draft/discard", `{}`,
		map[string]string{"id": unboundUser.Id})
	if err != nil {
		t.Fatalf("discard unbound draft: %v", err)
	}
	var d3 api.DiscardProjectionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &d3); err != nil {
		t.Fatal(err)
	}
	if !d3.DeletedProjection {
		t.Fatalf("discard unbound user draft = %+v, want deletedProjection=true", d3)
	}
	if _, err := app.FindRecordById(schema.ColProjection.String(), unboundUser.Id); err == nil {
		t.Fatal("expected unbound user projection to be hard-deleted")
	}
}
