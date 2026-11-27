package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/workerutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestReflectionLensReadAndEditEndpoints(t *testing.T) {
	app := testutil.NewApp(t)
	refl, err := reflections.Create(app, reflections.CreateParams{
		Name:       "Weekly Notes",
		WindowSpec: &api.WindowSpec{Period: "168h", Duration: "168h"},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Initially empty lens.
	rec, err := callJSON(t, app, HandleGetReflectionLens(app), http.MethodGet, "/api/reflections/"+refl.Id+"/lens", "", map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("get lens: %v", err)
	}
	var got api.ReflectionLensResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.LensID != "" || got.Prompt != "" {
		t.Fatalf("initial lens = %+v, want empty", got)
	}

	// Reject empty prompt.
	if _, err := callJSON(t, app, HandleUpdateReflectionLens(app), http.MethodPut, "/api/reflections/"+refl.Id+"/lens", `{"prompt":"   "}`, map[string]string{"id": refl.Id}); err == nil {
		t.Fatal("expected 400 for empty prompt")
	}

	// First PUT creates lens v1.
	rec, err = callJSON(t, app, HandleUpdateReflectionLens(app), http.MethodPut, "/api/reflections/"+refl.Id+"/lens", `{"prompt":"Summarize key themes."}`, map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("put lens v1: %v", err)
	}
	var v1 api.ReflectionLensResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &v1)
	if v1.LensID == "" || v1.Prompt != "Summarize key themes." {
		t.Fatalf("v1 = %+v", v1)
	}

	// Second PUT chains parent_lens_id to v1 and updates current_lens_id.
	rec, err = callJSON(t, app, HandleUpdateReflectionLens(app), http.MethodPut, "/api/reflections/"+refl.Id+"/lens", `{"prompt":"Summarize blockers and themes."}`, map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("put lens v2: %v", err)
	}
	var v2 api.ReflectionLensResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &v2)
	if v2.LensID == "" || v2.LensID == v1.LensID {
		t.Fatalf("v2 lensId = %q, want distinct from v1 %q", v2.LensID, v1.LensID)
	}
	lensRec, err := app.FindRecordById(schema.ColLens.String(), v2.LensID)
	if err != nil {
		t.Fatal(err)
	}
	if lensRec.GetString("parent_lens_id") != v1.LensID {
		t.Errorf("parent_lens_id = %q, want %q", lensRec.GetString("parent_lens_id"), v1.LensID)
	}

	// GET returns v2.
	rec, err = callJSON(t, app, HandleGetReflectionLens(app), http.MethodGet, "/api/reflections/"+refl.Id+"/lens", "", map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatal(err)
	}
	var reread api.ReflectionLensResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &reread)
	if reread.LensID != v2.LensID || reread.Prompt != "Summarize blockers and themes." {
		t.Errorf("reread = %+v, want v2", reread)
	}
}

func TestWindowSpecValidationBoundedAndPaused(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	start := time.Now().Add(-30 * day).UTC().Truncate(time.Second)
	end := start.Add(15 * day)

	// Reject missing windowSpec.
	if _, err := callJSON(t, app, HandleCreateReflection(app), http.MethodPost, "/api/reflections", `{"name":"unscheduled"}`, nil); err == nil {
		t.Fatal("expected 400 for missing windowSpec")
	}
	// Reject endTime <= startTime.
	badBody := `{"name":"bad","windowSpec":{"startTime":"` + end.Format(time.RFC3339) + `","endTime":"` + start.Format(time.RFC3339) + `","period":"168h","duration":"168h"}}`
	if _, err := callJSON(t, app, HandleCreateReflection(app), http.MethodPost, "/api/reflections", badBody, nil); err == nil {
		t.Fatal("expected 400 when endTime <= startTime")
	}

	// Bounded historical reflection: 30d ago to 15d ago (weekly) = exactly 2 completed weeks.
	boundedBody := `{"name":"archive","windowSpec":{"startTime":"` + start.Format(time.RFC3339) + `","endTime":"` + end.Format(time.RFC3339) + `","period":"168h","duration":"168h"}}`
	rec, err := callJSON(t, app, HandleCreateReflection(app), http.MethodPost, "/api/reflections", boundedBody, nil)
	if err != nil {
		t.Fatalf("create bounded: %v", err)
	}
	var created api.CreateReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	rec, err = callJSON(t, app, HandleListReflectionWindows(app), http.MethodGet, "/api/reflections/x/windows", "", map[string]string{"id": created.ReflectionID})
	if err != nil {
		t.Fatal(err)
	}
	var series api.ReflectionWindowsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &series)
	if len(series.Windows) != 2 {
		t.Fatalf("bounded windows = %d, want 2 (capped at endTime): %+v", len(series.Windows), series.Windows)
	}

	// Pause reflection: generate-pending skips new forward grid windows, while
	// explicit backfill still materializes and queues windows.
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "Summarize"})
	refl, _ := app.FindRecordById("reflection", created.ReflectionID)
	refl.Set("current_lens_id", lens.Id)
	refl.Set("current_context_spec", pbutil.JSONObject(api.ContextSpec{WholeScope: api.WholeScopeFull}))
	if err := app.Save(refl); err != nil {
		t.Fatal(err)
	}

	if _, err := callJSON(t, app, HandleUpdateReflection(app), http.MethodPatch, "/api/reflections/x",
		`{"windowSpec":{"period":"168h","duration":"168h","paused":true}}`, map[string]string{"id": created.ReflectionID}); err != nil {
		t.Fatalf("pause reflection: %v", err)
	}

	refl, _ = app.FindRecordById("reflection", created.ReflectionID)
	if pending := reflections.PendingWindows(app, refl, time.Now()); len(pending) != 0 {
		t.Fatalf("paused reflection pending = %d, want 0", len(pending))
	}

	// Explicit backfill still works while paused.
	bfFrom := start.Add(-15 * day).Format(time.RFC3339)
	rec, err = callJSON(t, app, HandleBackfillReflection(app, workerutil.DiscardRunner{}), http.MethodPost, "/api/reflections/x/backfill",
		`{"from":"`+bfFrom+`"}`, map[string]string{"id": created.ReflectionID})
	if err != nil {
		t.Fatalf("backfill while paused: %v", err)
	}
	var bfRes api.BackfillResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &bfRes)
	if len(bfRes.Windows) == 0 {
		t.Fatal("expected backfill to materialize windows even while paused")
	}
}

func TestEmptyWindowShortCircuitAndAutoUpgrade(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	var mu sync.Mutex
	llmCalls := 0
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return countingFakeProvider{
			onCall: func() {
				mu.Lock()
				llmCalls++
				mu.Unlock()
			},
			reply: "REAL LLM SUMMARY",
		}
	})

	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := time.Now().Add(-16 * day).UTC().Truncate(time.Second)
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "Weekly themes"})
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Weekly",
		"status":               engine.EntityActive,
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})

	// Seed fragment ONLY in week 2; week 1 has 0 matching fragments.
	dt := func(tm time.Time) types.DateTime { d, _ := types.ParseDateTime(tm); return d }
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "week 2 work", "occurred_at": dt(eff.Add(9 * day))})

	// Generate pending windows: week 1 must be hardcoded empty (0 LLM calls), week 2 calls LLM once.
	rec, err := callJSON(t, app, HandleGeneratePendingReflections(app), http.MethodPost, "/api/reflections/generate-pending", "", nil)
	if err != nil {
		t.Fatalf("generate-pending: %v", err)
	}
	var genRes api.ReflectionSnapshotResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &genRes)
	if len(genRes.SnapshotIDs) != 2 {
		t.Fatalf("snapshotIds = %d, want 2", len(genRes.SnapshotIDs))
	}
	mu.Lock()
	callsAfterFirst := llmCalls
	mu.Unlock()
	if callsAfterFirst != 1 {
		t.Fatalf("llm calls = %d, want 1 (empty week 1 must skip LLM)", callsAfterFirst)
	}

	grid := reflections.CurrentGridWindows(refl, time.Now())
	f1, p1 := engine.ApprovedSnapshotFilter(reflections.Strategy{}, refl.Id, &grid[0])
	w1Snaps, _ := app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(), f1, "-approval_sequence_number", 0, 0, p1)
	if len(w1Snaps) != 1 {
		t.Fatalf("w1 snaps = %d, want 1", len(w1Snaps))
	}
	if w1Snaps[0].GetString("output") != reflections.EmptyWindowOutput || w1Snaps[0].GetString("generated_by_model") != engine.SnapshotModelEmpty {
		t.Fatalf("w1 snap = output:%q model:%q, want empty sentinel", w1Snaps[0].GetString("output"), w1Snaps[0].GetString("generated_by_model"))
	}

	// Changing the lens does NOT flag the empty window as LensOutdated.
	if _, err := reflections.UpdateLens(app, refl.Id, "Revised lens"); err != nil {
		t.Fatal(err)
	}
	rec, err = callJSON(t, app, HandleListReflectionWindows(app), http.MethodGet, "/api/reflections/x/windows", "", map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatal(err)
	}
	var winList api.ReflectionWindowsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &winList)
	if winList.Windows[0].LensOutdated {
		t.Error("empty window was falsely flagged as lensOutdated")
	}
	if !winList.Windows[1].LensOutdated {
		t.Error("non-empty window should be flagged as lensOutdated")
	}

	// Backdate a fragment into empty week 1 -> evaluator puts it in PendingWindows
	// (NOT StaleWindows), and generate-pending automatically upgrades it!
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "backdated week 1 note", "occurred_at": dt(eff.Add(2 * day))})
	st, err := reconcile.EvaluateEntity(context.Background(), app, refl.Id)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.PendingWindows) != 1 || st.PendingWindows[0].ID != grid[0].ID {
		t.Fatalf("pendingWindows = %+v, want empty week 1 upgraded to pending", st.PendingWindows)
	}
	if len(st.StaleWindows) != 0 {
		t.Fatalf("staleWindows = %+v, want 0 (empty window belongs in pendingWindows)", st.StaleWindows)
	}

	rec, err = callJSON(t, app, HandleGeneratePendingReflections(app), http.MethodPost, "/api/reflections/generate-pending", "", nil)
	if err != nil {
		t.Fatalf("upgrade generate-pending: %v", err)
	}
	var upgradeRes api.ReflectionSnapshotResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &upgradeRes)
	if len(upgradeRes.SnapshotIDs) != 1 {
		t.Fatalf("upgraded snapshotIds = %v, want 1", upgradeRes.SnapshotIDs)
	}

	w1Snaps, _ = app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(), f1, "-approval_sequence_number", 0, 0, p1)
	if len(w1Snaps) != 2 {
		t.Fatalf("w1 snaps after upgrade = %d, want 2 (empty rev 1 + real rev 2)", len(w1Snaps))
	}
	if w1Snaps[0].GetInt("approval_sequence_number") != 2 || w1Snaps[0].GetString("output") != "REAL LLM SUMMARY" || w1Snaps[0].GetString("generated_by_model") == engine.SnapshotModelEmpty {
		t.Fatalf("upgraded snap = seq:%d out:%q model:%q", w1Snaps[0].GetInt("approval_sequence_number"), w1Snaps[0].GetString("output"), w1Snaps[0].GetString("generated_by_model"))
	}
}

func TestDirectPerWindowSnapshotEditing(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return testFakeProvider{reply: "REGENERATED OUTPUT"}
	})

	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := time.Now().Add(-10 * day).UTC().Truncate(time.Second)
	spec := api.ContextSpec{WholeScope: api.WholeScopeFull}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": "L"})
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Weekly",
		"status":               engine.EntityActive,
		"current_lens_id":      lens.Id,
		"current_context_spec": pbutil.JSONObject(spec),
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	dt := func(tm time.Time) types.DateTime { d, _ := types.ParseDateTime(tm); return d }
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "note", "occurred_at": dt(eff.Add(2 * day))})

	grid := reflections.CurrentGridWindows(refl, time.Now())
	win := grid[0]
	testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
		"reflection_id":            refl.Id,
		"status":                   engine.StatusApproved,
		"approval_sequence_number": 1,
		"lens_id":                  lens.Id,
		"output":                   "ORIGINAL SUMMARY",
		"generated_by_model":       "gemma4",
		"window_start":             win.Start,
		"window_end":               win.End,
		"context_spec":             pbutil.JSONObject(spec),
		"resolved_context":         pbutil.JSONObject(llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}),
	})

	// Empty edit is rejected.
	if _, err := callJSON(t, app, HandleEditReflectionWindow(app), http.MethodPost, "/api/reflections/x/windows/y/edit",
		`{"output":"   "}`, map[string]string{"id": refl.Id, "windowId": win.ID}); err == nil {
		t.Fatal("expected 400 for empty output")
	}

	// Direct edit appends revision 2 with generated_by_model = "manual".
	rec, err := callJSON(t, app, HandleEditReflectionWindow(app), http.MethodPost, "/api/reflections/x/windows/y/edit",
		`{"output":"  HUMAN EDITED SUMMARY  "}`, map[string]string{"id": refl.Id, "windowId": win.ID})
	if err != nil {
		t.Fatalf("edit window: %v", err)
	}
	var editRes api.EditReflectionWindowResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &editRes)
	if editRes.SnapshotID == "" {
		t.Fatal("expected non-empty snapshotId")
	}

	editedSnap, err := app.FindRecordById(schema.ColReflectionSnapshot.String(), editRes.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if editedSnap.GetInt("approval_sequence_number") != 2 ||
		editedSnap.GetString("output") != "HUMAN EDITED SUMMARY" ||
		editedSnap.GetString("generated_by_model") != engine.SnapshotModelManual ||
		editedSnap.GetString("lens_id") != lens.Id {
		t.Fatalf("edited snap fields wrong: seq=%d out=%q model=%q lens=%q",
			editedSnap.GetInt("approval_sequence_number"), editedSnap.GetString("output"),
			editedSnap.GetString("generated_by_model"), editedSnap.GetString("lens_id"))
	}

	// Must not flag lensOutdated, stale, or model mismatch.
	if cur, reason := engine.SnapshotCurrency(refl, editedSnap, llmcontext.PinnedIDs{FragmentIDs: []string{frag.Id}}); !cur {
		t.Errorf("manual edit snapshot flagged non-current: %q", reason)
	}
	rec, err = callJSON(t, app, HandleListReflectionWindows(app), http.MethodGet, "/api/reflections/x/windows", "", map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatal(err)
	}
	var winList api.ReflectionWindowsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &winList)
	if winList.Windows[0].LensOutdated || winList.Windows[0].Stale {
		t.Errorf("manual edit caused false flags: %+v", winList.Windows[0])
	}

	// Manual regeneration still works and appends revision 3 (preserving revision 2 in history).
	rec, err = callJSON(t, app, HandleGenerateReflectionSnapshot(app), http.MethodPost, "/api/reflections/x/generate-snapshot",
		`{"windowId":"`+win.ID+`","preview":true}`, map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("regenerate after manual edit: %v", err)
	}
	allRevs, _ := app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(),
		"reflection_id = {:id} && status = 'approved'", "approval_sequence_number", 0, 0, dbx.Params{"id": refl.Id})
	if len(allRevs) != 3 {
		t.Fatalf("revisions = %d, want 3 (original + manual + regenerated)", len(allRevs))
	}
	if allRevs[2].GetString("output") != "REGENERATED OUTPUT" {
		t.Errorf("rev 3 output = %q, want REGENERATED OUTPUT", allRevs[2].GetString("output"))
	}
}

func TestReflectionChatOneStepSetLensAndPreviewVisibility(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	eff := time.Now().Add(-15 * day).UTC().Truncate(time.Second)
	versions := reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, eff)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "Untitled reflection",
		"status":               engine.EntityProposed,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	dt := func(tm time.Time) types.DateTime { d, _ := types.ParseDateTime(tm); return d }
	// Fragment in current week (week 2); week 1 is empty!
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "Shipped auth migration and fixed login bug", "occurred_at": dt(eff.Add(10 * day)),
	})

	created, refRec := openRefinement(t, app, refl.Id, `{"clientId":"stage2-chat-1"}`)
	_ = created

	script := &reflectionChatScript{
		setLensPrompt: "Summarize shipped work in 3 crisp bullets.",
		suggestName:   "Weekly Shipping Log",
		chatText:      "I drafted a standing lens focused on shipped work.",
		applyOut:      "- Shipped auth migration\n- Fixed login bug",
	}
	script.install(t)

	// Turn 1: user asks for summary -> assistant calls set_lens -> isolated ApplyPrompt runs.
	turn1Body := `{"id":"stage2-chat-1","messages":[` +
		`{"id":"sys-ctx","role":"system","parts":[{"type":"context_spec","data":{"wholeScope":"full"}}]},` +
		`{"id":"u1","role":"user","parts":[{"type":"text","text":"Summarize what shipped each week."}]}` +
		`]}`
	rec, err := callJSON(t, app, HandleReflectionRefinementChat(app), http.MethodPost,
		"/api/reflections/"+refl.Id+"/refinements/"+refRec.Id+"/chat", turn1Body,
		map[string]string{"id": refl.Id, "rid": refRec.Id})
	if err != nil {
		t.Fatalf("turn 1: %v", err)
	}
	if !strings.Contains(rec.Body.String(), "apply_result") || !strings.Contains(rec.Body.String(), "Shipped auth migration") {
		t.Fatalf("turn 1 SSE missing apply_result preview:\n%s", rec.Body.String())
	}

	script.mu.Lock()
	t1Tools := append([]string(nil), script.advertisedTools[0]...)
	t1Applies := append([]string(nil), script.applyCalls...)
	t1ApplyMsgCounts := append([]int(nil), script.applyMsgCounts...)
	script.mu.Unlock()

	// Verify only Stage 2 reflection tools were advertised.
	toolSet := map[string]bool{}
	for _, name := range t1Tools {
		toolSet[name] = true
	}
	if !toolSet[prompts.SetLensToolName] || !toolSet[prompts.UpdateContextToolName] || !toolSet[prompts.SuggestNameToolName] {
		t.Fatalf("turn 1 tools = %v, want set_lens, update_context, suggest_name", t1Tools)
	}
	for _, forbidden := range []string{prompts.UpdateLensToolName, prompts.RefineCandidateToolName, prompts.RegenerateFromLensToolName, prompts.WriteDraftToolName} {
		if toolSet[forbidden] {
			t.Errorf("forbidden tool %q advertised on reflection chat", forbidden)
		}
	}
	// Verify apply ran in isolation (1 user message, zero chat history, contains sample fragment).
	if len(t1Applies) != 1 || t1ApplyMsgCounts[0] != 1 {
		t.Fatalf("apply calls = %d msgCounts = %v, want 1 isolated call", len(t1Applies), t1ApplyMsgCounts)
	}
	if !strings.Contains(t1Applies[0], "Summarize shipped work in 3 crisp bullets.") || !strings.Contains(t1Applies[0], "Shipped auth migration") {
		t.Errorf("isolated apply prompt missing lens or fragment:\n%s", t1Applies[0])
	}

	// Turn 2: user critiques preview -> verify Turn 2 system prompt contains the read-only latest preview!
	script.mu.Lock()
	script.setLensPrompt = "Summarize shipped work in 2 ultra-short bullets."
	script.suggestName = ""
	script.chatText = "Tightened the lens to 2 bullets."
	script.applyOut = "- Auth migration\n- Login fix"
	script.mu.Unlock()

	turn2Body := `{"id":"stage2-chat-1","messages":[{"id":"u2","role":"user","parts":[{"type":"text","text":"Make it even shorter."}]}]}`
	if _, err := callJSON(t, app, HandleReflectionRefinementChat(app), http.MethodPost,
		"/api/reflections/"+refl.Id+"/refinements/"+refRec.Id+"/chat", turn2Body,
		map[string]string{"id": refl.Id, "rid": refRec.Id}); err != nil {
		t.Fatalf("turn 2: %v", err)
	}

	script.mu.Lock()
	t2SysPrompt := script.chatHistory[1][0].Content
	script.mu.Unlock()
	if !strings.Contains(t2SysPrompt, "- Shipped auth migration") {
		t.Errorf("turn 2 system prompt did not inject latest preview:\n%s", t2SysPrompt)
	}
	if !strings.Contains(t2SysPrompt, "cannot edit preview text directly") && !strings.Contains(t2SysPrompt, "CANNOT edit preview text directly") {
		t.Errorf("turn 2 system prompt missing read-only preview guidance")
	}

	// Window switch to empty week 1 -> skips LLM apply call and returns hardcoded empty text.
	grid := reflections.CurrentGridWindows(refl, time.Now())
	emptyWin := grid[0]
	winBytes, _ := json.Marshal(emptyWin)
	reapplyBody := `{"id":"stage2-chat-1","messages":[{"id":"sys-empty-win","role":"system","parts":[{"type":"window","data":` + string(winBytes) + `}]}]}`
	rec, err = callJSON(t, app, HandleReflectionRefinementChat(app), http.MethodPost,
		"/api/reflections/"+refl.Id+"/refinements/"+refRec.Id+"/chat", reapplyBody,
		map[string]string{"id": refl.Id, "rid": refRec.Id})
	if err != nil {
		t.Fatalf("empty window reapply: %v", err)
	}
	if !strings.Contains(rec.Body.String(), reflections.EmptyWindowOutput) {
		t.Errorf("empty sample window SSE did not return hardcoded empty output:\n%s", rec.Body.String())
	}
	script.mu.Lock()
	applyCountAfterEmpty := len(script.applyCalls)
	script.mu.Unlock()
	if applyCountAfterEmpty != 2 {
		t.Errorf("empty sample window triggered LLM call: applyCalls=%d, want 2", applyCountAfterEmpty)
	}

	// Commit installs the latest lens from set_lens and activates the reflection.
	rec, err = callJSON(t, app, HandleCommitReflectionRefinement(app, testDeps(app)), http.MethodPost,
		"/api/reflections/"+refl.Id+"/refinements/"+refRec.Id+"/commit", "",
		map[string]string{"id": refl.Id, "rid": refRec.Id})
	if err != nil {
		t.Fatalf("commit reflection refinement: %v", err)
	}
	reflAfter, _ := app.FindRecordById("reflection", refl.Id)
	if reflAfter.GetString("status") != engine.EntityActive {
		t.Errorf("status after commit = %q, want active", reflAfter.GetString("status"))
	}
	_, installedPrompt := engine.ReadActiveLens(app, reflections.Strategy{}, reflAfter)
	if installedPrompt != "Summarize shipped work in 2 ultra-short bullets." {
		t.Errorf("installed lens prompt = %q, want turn 2 set_lens prompt", installedPrompt)
	}

	// Verify persisted messages contain tool-set_lens and Flatten echoes it.
	msgs, _ := chat.LoadMessages(context.Background(), app, refRec)
	flat := llmcontext.Flatten(msgs)
	foundSetLensEcho := false
	for _, m := range flat {
		if strings.Contains(m.Content, "Summarize shipped work in 2 ultra-short bullets.") {
			foundSetLensEcho = true
		}
	}
	if !foundSetLensEcho {
		t.Error("llmcontext.Flatten did not echo tool-set_lens prompt")
	}
}

type countingFakeProvider struct {
	onCall func()
	reply  string
}

func (countingFakeProvider) ContextWindow() int { return 256_000 }

func (p countingFakeProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	if p.onCall != nil {
		p.onCall()
	}
	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: p.reply}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

type reflectionChatScript struct {
	mu              sync.Mutex
	setLensPrompt   string
	suggestName     string
	chatText        string
	applyOut        string
	chatHistory     [][]llm.Message
	advertisedTools [][]string
	applyCalls      []string
	applyMsgCounts  []int
}

func (s *reflectionChatScript) install(t *testing.T) {
	t.Helper()
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return reflectionChatScriptProvider{s}
	})
}

type reflectionChatScriptProvider struct{ s *reflectionChatScript }

func (p reflectionChatScriptProvider) ContextWindow() int { return 256_000 }

func (p reflectionChatScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	p.s.mu.Lock()
	if msgs[0].Role == "system" && strings.Contains(msgs[0].Content, "author a standing lens for a Reflection") {
		p.s.chatHistory = append(p.s.chatHistory, msgs)
		names := make([]string, 0, len(tools))
		for _, tool := range tools {
			names = append(names, tool.Name)
		}
		p.s.advertisedTools = append(p.s.advertisedTools, names)
		setPrompt := p.s.setLensPrompt
		suggestName := p.s.suggestName
		chatText := p.s.chatText
		p.s.mu.Unlock()

		ch := make(chan llm.StreamEvent, 8)
		if suggestName != "" {
			args, _ := json.Marshal(map[string]string{"name": suggestName})
			ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-name", ToolName: prompts.SuggestNameToolName}
			ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-name", ToolName: prompts.SuggestNameToolName, Args: args}
		}
		if chatText != "" {
			ch <- llm.StreamEvent{Kind: llm.EventText, Text: chatText}
		}
		if setPrompt != "" {
			args, _ := json.Marshal(prompts.SetLensArgs{Prompt: setPrompt})
			ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-lens", ToolName: prompts.SetLensToolName}
			ch <- llm.StreamEvent{Kind: llm.EventToolArgDelta, ToolCallID: "tc-lens", Text: string(args)}
			ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-lens", ToolName: prompts.SetLensToolName, Args: args}
		}
		close(ch)
		return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
	}

	p.s.applyCalls = append(p.s.applyCalls, msgs[0].Content)
	p.s.applyMsgCounts = append(p.s.applyMsgCounts, len(msgs))
	out := p.s.applyOut
	p.s.mu.Unlock()

	ch := make(chan llm.StreamEvent, 1)
	ch <- llm.StreamEvent{Kind: llm.EventText, Text: out}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

func TestStagedPreviewWindowsAndPreviewEndpoints(t *testing.T) {
	llm.SetActiveModelSet(llm.SetLocal)
	var mu sync.Mutex
	llmCalls := 0
	var lastPrompt string
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return countingFakeProvider{
			onCall: func() {
				mu.Lock()
				llmCalls++
				mu.Unlock()
			},
			reply: "STAGED PREVIEW OUTPUT",
		}
	})

	app := testutil.NewApp(t)
	day := 24 * time.Hour
	start := time.Now().Add(-35 * day).UTC().Truncate(time.Second)
	dt := func(tm time.Time) types.DateTime { d, _ := types.ParseDateTime(tm); return d }

	// Seed fragments across the last 35 days: 2 in the newest week, 1 older (20d ago).
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "Recent note 1", "occurred_at": dt(start.Add(30 * day)),
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "Recent note 2", "occurred_at": dt(start.Add(31 * day)),
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "Older month note", "occurred_at": dt(start.Add(12 * day)),
	})

	// Weekly schedule preview-windows -> multiple weekly windows, 0 LLM calls.
	weeklyBody := `{"windowSpec":{"startTime":"` + start.Format(time.RFC3339) + `","period":"168h","duration":"168h"},"contextSpec":{"wholeScope":"full"}}`
	rec, err := callJSON(t, app, HandlePreviewReflectionWindows(app), http.MethodPost, "/api/reflections/preview-windows", weeklyBody, nil)
	if err != nil {
		t.Fatalf("preview-windows weekly: %v", err)
	}
	var weeklyRes api.PreviewReflectionWindowsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &weeklyRes); err != nil {
		t.Fatal(err)
	}
	if len(weeklyRes.Windows) < 4 || weeklyRes.DefaultWindowID == "" {
		t.Fatalf("weekly preview windows = %+v, want >=4 with defaultWindowId", weeklyRes)
	}

	// Switch to monthly (720h) -> 1 completed monthly window with all 3 fragments!
	monthlyBody := `{"windowSpec":{"startTime":"` + start.Format(time.RFC3339) + `","period":"720h","duration":"720h"},"contextSpec":{"wholeScope":"full"}}`
	rec, err = callJSON(t, app, HandlePreviewReflectionWindows(app), http.MethodPost, "/api/reflections/preview-windows", monthlyBody, nil)
	if err != nil {
		t.Fatalf("preview-windows monthly: %v", err)
	}
	var monthlyRes api.PreviewReflectionWindowsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &monthlyRes); err != nil {
		t.Fatal(err)
	}
	if len(monthlyRes.Windows) != 1 {
		t.Fatalf("monthly preview windows = %d, want 1", len(monthlyRes.Windows))
	}
	if monthlyRes.Windows[0].FragmentCount < 1 {
		t.Fatalf("monthly fragmentCount = %d, want >= 1", monthlyRes.Windows[0].FragmentCount)
	}

	// Bounded endTime caps windows.
	end := start.Add(15 * day)
	boundedBody := `{"windowSpec":{"startTime":"` + start.Format(time.RFC3339) + `","endTime":"` + end.Format(time.RFC3339) + `","period":"168h","duration":"168h"},"contextSpec":{"wholeScope":"full"}}`
	rec, err = callJSON(t, app, HandlePreviewReflectionWindows(app), http.MethodPost, "/api/reflections/preview-windows", boundedBody, nil)
	if err != nil {
		t.Fatalf("preview-windows bounded: %v", err)
	}
	var boundedRes api.PreviewReflectionWindowsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &boundedRes)
	if len(boundedRes.Windows) != 2 {
		t.Fatalf("bounded preview windows = %d, want 2", len(boundedRes.Windows))
	}
	// Week 1 ([start, start+7d)) has 0 fragments; week 2 ([start+7d, start+14d)) has 1 fragment.
	if boundedRes.Windows[0].FragmentCount != 0 || boundedRes.Windows[1].FragmentCount != 1 {
		t.Fatalf("bounded counts = [%d, %d], want [0, 1]", boundedRes.Windows[0].FragmentCount, boundedRes.Windows[1].FragmentCount)
	}

	mu.Lock()
	callsBeforePreview := llmCalls
	mu.Unlock()
	if callsBeforePreview != 0 {
		t.Fatalf("preview-windows made %d LLM calls, want 0", callsBeforePreview)
	}

	// POST /api/reflections/preview on empty window -> skips LLM, returns EmptyWindowOutput.
	emptyWinBytes, _ := json.Marshal(boundedRes.Windows[0].Window)
	emptyPreviewBody := `{"lensPrompt":"Summarize notes.","contextSpec":{"wholeScope":"full"},"window":` + string(emptyWinBytes) + `}`
	rec, err = callJSON(t, app, HandlePreviewReflection(app), http.MethodPost, "/api/reflections/preview", emptyPreviewBody, nil)
	if err != nil {
		t.Fatalf("preview empty window: %v", err)
	}
	var emptyPrev api.PreviewReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &emptyPrev)
	if !emptyPrev.Empty || emptyPrev.Output != reflections.EmptyWindowOutput || emptyPrev.FragmentCount != 0 {
		t.Fatalf("empty preview = %+v", emptyPrev)
	}
	mu.Lock()
	callsAfterEmpty := llmCalls
	mu.Unlock()
	if callsAfterEmpty != 0 {
		t.Fatalf("empty preview made %d LLM calls, want 0", callsAfterEmpty)
	}

	// POST /api/reflections/preview on populated window -> 1 isolated LLM call, no DB mutations.
	_ = lastPrompt
	popWinBytes, _ := json.Marshal(boundedRes.Windows[1].Window)
	popPreviewBody := `{"lensPrompt":"Summarize notes.","contextSpec":{"wholeScope":"full"},"window":` + string(popWinBytes) + `}`
	rec, err = callJSON(t, app, HandlePreviewReflection(app), http.MethodPost, "/api/reflections/preview", popPreviewBody, nil)
	if err != nil {
		t.Fatalf("preview populated window: %v", err)
	}
	var popPrev api.PreviewReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &popPrev)
	if popPrev.Empty || popPrev.Output != "STAGED PREVIEW OUTPUT" || popPrev.FragmentCount != 1 {
		t.Fatalf("populated preview = %+v", popPrev)
	}
	mu.Lock()
	callsAfterPop := llmCalls
	mu.Unlock()
	if callsAfterPop != 1 {
		t.Fatalf("populated preview made %d LLM calls, want 1", callsAfterPop)
	}
}

func TestAtomicSaveReflectionTuningAndCancelLeavesUntouched(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	start := time.Now().Add(-20 * day).UTC().Truncate(time.Second)

	// Create an established reflection with v1 weekly schedule and v1 lens.
	refl, err := reflections.Create(app, reflections.CreateParams{
		Name:       "Weekly Log",
		WindowSpec: &api.WindowSpec{StartTime: start.Format(time.RFC3339), Period: "168h", Duration: "168h"},
	})
	if err != nil {
		t.Fatal(err)
	}
	v1Lens, err := reflections.UpdateLens(app, refl.Id, "Original weekly lens")
	if err != nil {
		t.Fatal(err)
	}

	// Schedule-only + direct-lens-only save WITHOUT opening a chat refinement session.
	saveBody := `{"windowSpec":{"period":"720h","duration":"720h","paused":true},"contextSpec":{"wholeScope":"full"},"lensPrompt":"Revised monthly lens","name":"Monthly Log"}`
	rec, err := callJSON(t, app, HandleSaveReflection(app, testDeps(app)), http.MethodPost, "/api/reflections/"+refl.Id+"/save", saveBody, map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("atomic save: %v", err)
	}
	var saveRes api.SaveReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &saveRes)
	if saveRes.ID != refl.Id || saveRes.LensID == "" || saveRes.LensID == v1Lens.LensID {
		t.Fatalf("saveRes = %+v, want new lensId distinct from %q", saveRes, v1Lens.LensID)
	}

	updated, err := app.FindRecordById(schema.ColReflection.String(), refl.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("name") != "Monthly Log" {
		t.Errorf("name = %q, want Monthly Log", updated.GetString("name"))
	}
	_, gotPrompt := engine.ReadActiveLens(app, reflections.Strategy{}, updated)
	if gotPrompt != "Revised monthly lens" {
		t.Errorf("lens = %q, want Revised monthly lens", gotPrompt)
	}
	versions := reflections.LoadWindowSpecVersions(updated)
	if len(versions) != 2 || versions[1].Spec.Period != "720h" || !versions[1].Spec.Paused {
		t.Errorf("window_spec_versions = %+v, want 2 versions with monthly paused v2", versions)
	}

	// Saving again with schedule-only change (identical lens) must NOT create a duplicate lens row.
	schedOnlyBody := `{"windowSpec":{"period":"24h","duration":"24h"}}`
	rec, err = callJSON(t, app, HandleSaveReflection(app, testDeps(app)), http.MethodPost, "/api/reflections/"+refl.Id+"/save", schedOnlyBody, map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatalf("schedule-only save: %v", err)
	}
	var schedRes api.SaveReflectionResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &schedRes)
	if schedRes.LensID != saveRes.LensID {
		t.Errorf("schedule-only save created new lens %q, want reused %q", schedRes.LensID, saveRes.LensID)
	}

	// Never-saved reflection: commit with staged schedule replaces v1 cleanly (keeps 1 version with new startTime).
	draft, err := reflections.Create(app, reflections.CreateParams{
		Name:       "Fresh Draft",
		WindowSpec: &api.WindowSpec{StartTime: start.Format(time.RFC3339), Period: "168h", Duration: "168h"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, refRec := openRefinement(t, app, draft.Id, `{"clientId":"draft-commit-staged"}`)
	newStart := time.Now().Add(-30 * day).UTC().Truncate(time.Second)
	commitBody := `{"windowSpec":{"startTime":"` + newStart.Format(time.RFC3339) + `","period":"720h","duration":"720h"},"contextSpec":{"wholeScope":"full"},"lensPrompt":"First saved standing lens"}`
	rec, err = callJSON(t, app, HandleCommitReflectionRefinement(app, testDeps(app)), http.MethodPost,
		"/api/reflections/"+draft.Id+"/refinements/"+refRec.Id+"/commit", commitBody,
		map[string]string{"id": draft.Id, "rid": refRec.Id})
	if err != nil {
		t.Fatalf("commit with staged overrides: %v", err)
	}
	savedDraft, _ := app.FindRecordById(schema.ColReflection.String(), draft.Id)
	draftVersions := reflections.LoadWindowSpecVersions(savedDraft)
	if len(draftVersions) != 1 || draftVersions[0].Spec.Period != "720h" || draftVersions[0].Spec.StartTime != newStart.Format(time.RFC3339) {
		t.Fatalf("never-saved commit versions = %+v, want single replaced v1 with newStart+monthly", draftVersions)
	}
}

func TestDiscardReflectionDraftLifecycle(t *testing.T) {
	app := testutil.NewApp(t)

	// 1. User-created never-saved reflection -> hard-deleted (cascading refinements).
	userDraft, err := reflections.Create(app, reflections.CreateParams{
		Name:       "Unsaved User Reflection",
		WindowSpec: &api.WindowSpec{Period: "168h", Duration: "168h"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, refRec := openRefinement(t, app, userDraft.Id, `{"clientId":"discard-user-1"}`)

	rec, err := callJSON(t, app, HandleDiscardReflectionDraft(app), http.MethodPost,
		"/api/reflections/"+userDraft.Id+"/draft/discard", "", map[string]string{"id": userDraft.Id})
	if err != nil {
		t.Fatalf("discard user draft: %v", err)
	}
	var userRes api.DiscardReflectionDraftResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &userRes)
	if !userRes.DeletedReflection || userRes.RevertedToProposed {
		t.Fatalf("user discard res = %+v, want deletedReflection=true", userRes)
	}
	if _, err := app.FindRecordById(schema.ColReflection.String(), userDraft.Id); err == nil {
		t.Error("user-created draft reflection still exists after discard")
	}
	if _, err := app.FindRecordById(schema.ColReflectionRefinement.String(), refRec.Id); err == nil {
		t.Error("refinement record still exists after reflection hard delete")
	}

	// 2. Discover-originated never-saved reflection -> deletes refinements and reverts to status="proposed".
	discoverRun := testutil.NewRecord(t, app, "discover_run", map[string]any{
		"status": "done",
		"kind":   "reflections",
	})
	discDraft := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                       "Proposed Weekly",
		"status":                     engine.EntityActive,
		"created_by_discover_run_id": discoverRun.Id,
		"window_spec_versions":       pbutil.JSONObject(reflections.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, time.Now())),
	})
	_, discRef := openRefinement(t, app, discDraft.Id, `{"clientId":"discard-disc-1"}`)

	rec, err = callJSON(t, app, HandleDiscardReflectionDraft(app), http.MethodPost,
		"/api/reflections/"+discDraft.Id+"/draft/discard", "", map[string]string{"id": discDraft.Id})
	if err != nil {
		t.Fatalf("discard discover draft: %v", err)
	}
	var discRes api.DiscardReflectionDraftResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &discRes)
	if !discRes.RevertedToProposed || discRes.DeletedReflection {
		t.Fatalf("discover discard res = %+v, want revertedToProposed=true", discRes)
	}
	reloaded, err := app.FindRecordById(schema.ColReflection.String(), discDraft.Id)
	if err != nil {
		t.Fatalf("discover reflection disappeared: %v", err)
	}
	if reloaded.GetString("status") != engine.EntityProposed {
		t.Errorf("discover status = %q, want proposed", reloaded.GetString("status"))
	}
	if _, err := app.FindRecordById(schema.ColReflectionRefinement.String(), discRef.Id); err == nil {
		t.Error("discover draft refinement still exists after revert")
	}

	// 3. Established reflection (with current_lens_id) -> refused with 409 Conflict.
	saved, err := reflections.Create(app, reflections.CreateParams{
		Name:       "Established Reflection",
		WindowSpec: &api.WindowSpec{Period: "168h", Duration: "168h"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reflections.UpdateLens(app, saved.Id, "Standing lens"); err != nil {
		t.Fatal(err)
	}
	if _, err := callJSON(t, app, HandleDiscardReflectionDraft(app), http.MethodPost,
		"/api/reflections/"+saved.Id+"/draft/discard", "", map[string]string{"id": saved.Id}); err == nil {
		t.Fatal("expected 409 error when discarding established reflection")
	}
	if _, err := app.FindRecordById(schema.ColReflection.String(), saved.Id); err != nil {
		t.Fatalf("established reflection was deleted: %v", err)
	}
}
