package handlers

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/chat"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

// A reflection refinement is bound to a target window: the session is seeded
// with the reflection's current window, the apply leg sees only fragments
// inside it (and is told the bounds), and the commit files the snapshot under
// that window's key.
func TestReflectionRefinementIsScopedToItsWindow(t *testing.T) {
	app := testutil.NewApp(t)
	day := 24 * time.Hour
	effective := time.Now().Add(-15 * day).UTC()
	// Weekly, tumbling, effective 15 days ago: two completed windows; the
	// current one is [eff+7d, eff+14d).
	versions := engine.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, effective)
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name":                 "weekly",
		"status":               engine.EntityActive,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	dt := func(tm time.Time) types.DateTime {
		d, _ := types.ParseDateTime(tm)
		return d
	}
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "INSIDE THE CURRENT WEEK", "source_time": dt(effective.Add(10 * day)),
	})
	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type": "note", "content": "IN THE PREVIOUS WEEK", "source_time": dt(effective.Add(2 * day)),
	})

	// Open the session through the handler so the seed is the real one.
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/reflections/"+refl.Id+"/refinements", strings.NewReader(`{"clientId":"win-1"}`))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Request.SetPathValue("id", refl.Id)
	e.Response = rec
	if err := HandleCreateReflectionRefinement(app)(e); err != nil {
		t.Fatalf("create refinement: %v", err)
	}
	var created api.CreateRefinementResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	_, _, seededWin := extractWindow(t, created.Messages)
	wantStart, wantEnd := effective.Add(7*day).Format(time.RFC3339), effective.Add(14*day).Format(time.RFC3339)
	if seededWin == nil || seededWin.Start != wantStart || seededWin.End != wantEnd {
		t.Fatalf("seeded window = %+v, want [%s, %s)", seededWin, wantStart, wantEnd)
	}

	refRec, err := app.FindRecordById("refine_refl_snapshot_conversation", created.RefinementID)
	if err != nil {
		t.Fatal(err)
	}

	script := &refineScript{lens: "WEEKLY LENS", applyOut: "THE WEEK"}
	script.install(t)

	// The client's first turn carries its context selection alongside the
	// user text, as ChatPanel does.
	req := api.ChatRequest{
		ID: "win-1",
		Messages: []api.UIMessage{
			{ID: "sys-1", Role: "system", Parts: []api.UIMessagePart{{Type: "context_spec", Data: raw(t, api.ContextSpec{WholeScope: true})}}},
			{ID: "user-1", Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: "summarize the week"}}},
		},
	}
	rec = httptest.NewRecorder()
	e = &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/chat", nil)
	e.Response = rec
	if err := HandleChatForRefinement(app, req, refRec)(e); err != nil {
		t.Fatalf("chat turn: %v", err)
	}

	script.mu.Lock()
	applies := append([]string(nil), script.applyCalls...)
	script.mu.Unlock()
	if len(applies) != 1 {
		t.Fatalf("apply calls = %d, want 1", len(applies))
	}
	if !strings.Contains(applies[0], "INSIDE THE CURRENT WEEK") {
		t.Error("apply prompt is missing the in-window fragment")
	}
	if strings.Contains(applies[0], "IN THE PREVIOUS WEEK") {
		t.Error("apply prompt leaked a fragment from outside the window")
	}
	if !strings.Contains(applies[0], "Source Documents from ") {
		t.Error("apply prompt does not state the window bounds")
	}

	// Commit installs the lens and publishes nothing: the previewed window was
	// a sample. Every window the grid owes is then pending for the runner.
	rec = httptest.NewRecorder()
	e = &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/reflections/"+refl.Id+"/refinements/"+refRec.Id+"/commit", nil)
	e.Request.SetPathValue("id", refl.Id)
	e.Request.SetPathValue("rid", refRec.Id)
	e.Response = rec
	if err := HandleCommitReflectionRefinement(app)(e); err != nil {
		t.Fatalf("commit: %v", err)
	}
	refl, err = app.FindRecordById("reflection", refl.Id)
	if err != nil {
		t.Fatal(err)
	}
	if refl.GetString("current_lens_id") == "" {
		t.Fatal("commit did not install a lens")
	}
	snaps, _ := app.FindRecordsByFilter("reflection_snapshot", "reflection_id = {:id}", "", 0, 0, map[string]any{"id": refl.Id})
	if len(snaps) != 0 {
		t.Fatalf("commit published %d snapshots, want none", len(snaps))
	}
	if pending := engine.PendingWindows(app, refl, time.Now()); len(pending) != 2 {
		t.Errorf("pending after commit = %d, want both grid windows", len(pending))
	}

	// And the persisted transcript's context is window-scoped.
	msgs, err := chat.LoadMessages(context.Background(), app, refRec)
	if err != nil {
		t.Fatal(err)
	}
	pinned, _, _ := extractWindow(t, msgs)
	if len(pinned) != 1 {
		t.Errorf("pinned fragments = %d, want only the in-window one", len(pinned))
	}
}

// An over-sized context is refused before the model is called, with an
// actionable message rather than a provider error.
func TestRefinementRefusesContextTooLarge(t *testing.T) {
	app := testutil.NewApp(t)
	ref := newRefinement(t, app)
	// 256k-token window in the scripted provider; ~1.5M chars of context.
	big := strings.Repeat("lorem ipsum dolor sit amet ", 60_000)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": big})
	persist(t, app, ref, api.UIMessage{ID: "sys-1", Role: "system", Parts: []api.UIMessagePart{
		{Type: "context_spec", Data: raw(t, api.ContextSpec{FragmentIDs: []string{frag.Id}})},
		{Type: "pinned_ids", Data: raw(t, map[string][]string{"fragmentIds": {frag.Id}})},
	}})
	script := &refineScript{lens: "L", applyOut: "OUT"}
	script.install(t)

	req := api.ChatRequest{ID: "client-1", Messages: []api.UIMessage{
		{ID: "user-1", Role: "user", Parts: []api.UIMessagePart{{Type: "text", Text: "go"}}},
	}}
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/chat", nil)
	e.Response = rec
	err := HandleChatForRefinement(app, req, refRec(t, app, ref))(e)
	if err == nil {
		t.Fatalf("expected a refusal, got 200:\n%.200s", rec.Body.String())
	}
	if !strings.Contains(err.Error(), "narrow the window or the context") {
		t.Errorf("error = %v, want the context-too-large message", err)
	}
	script.mu.Lock()
	applies := len(script.applyCalls)
	script.mu.Unlock()
	if applies != 0 {
		t.Errorf("apply calls = %d, want none", applies)
	}
}

func refRec(t *testing.T, app core.App, ref *core.Record) *core.Record {
	t.Helper()
	r, err := app.FindRecordById(ref.Collection().Name, ref.Id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// extractWindow reads the newest pinned fragment ids, context spec and window
// parts off a transcript, as the server does.
func extractWindow(t *testing.T, msgs []api.UIMessage) ([]string, api.ContextSpec, *api.Window) {
	t.Helper()
	var win *api.Window
	var spec api.ContextSpec
	var pinned struct {
		FragmentIDs []string `json:"fragmentIds"`
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role != "system" {
			continue
		}
		for _, p := range msgs[i].Parts {
			switch p.Type {
			case "window":
				if win == nil {
					var w api.Window
					if json.Unmarshal(p.Data, &w) == nil {
						win = &w
					}
				}
			case "context_spec":
				_ = json.Unmarshal(p.Data, &spec)
			case "pinned_ids":
				if pinned.FragmentIDs == nil {
					_ = json.Unmarshal(p.Data, &pinned)
				}
			}
		}
	}
	return pinned.FragmentIDs, spec, win
}

// scheduledReflection is a weekly reflection effective 15 days ago (two
// completed windows) with a lens and an approved snapshot for its current
// window, produced by that lens.
func scheduledReflection(t *testing.T, app core.App) (refl *core.Record, current api.Window) {
	t.Helper()
	day := 24 * time.Hour
	effective := time.Now().Add(-15 * day).UTC()
	spec := api.ContextSpec{WholeScope: true}
	lens := testutil.NewRecord(t, app, "lens", map[string]any{
		"prompt": pbutil.JSONString("THE CURRENT LENS"), "context_spec": pbutil.JSONObject(spec),
	})
	versions := engine.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, effective)
	refl = testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "weekly", "status": engine.EntityActive,
		"current_context_spec": pbutil.JSONObject(spec),
		"current_lens_id":      lens.Id,
		"window_spec_versions": pbutil.JSONObject(versions),
	})
	grid := engine.CurrentGridWindows(refl, time.Now())
	current = grid[len(grid)-1]
	testutil.NewRecord(t, app, "reflection_snapshot", map[string]any{
		"reflection_id": refl.Id, "status": engine.StatusApproved, "approval_sequence_number": 1,
		"lens_id": lens.Id, "output": pbutil.JSONString("THIS WEEK'S SUMMARY"),
		"window_key":      engine.WindowKey(current),
		"resolved_window": pbutil.JSONObject(map[string]string{"start": current.Start, "end": current.End}),
	})
	return refl, current
}

func openRefinement(t *testing.T, app core.App, reflID, body string) (api.CreateRefinementResponse, *core.Record) {
	t.Helper()
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/reflections/"+reflID+"/refinements", strings.NewReader(body))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Request.SetPathValue("id", reflID)
	e.Response = rec
	if err := HandleCreateReflectionRefinement(app)(e); err != nil {
		t.Fatalf("create refinement: %v", err)
	}
	var created api.CreateRefinementResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	refRec, err := app.FindRecordById("refine_refl_snapshot_conversation", created.RefinementID)
	if err != nil {
		t.Fatal(err)
	}
	return created, refRec
}

// Refining an existing reflection opens with its current lens already drafted
// and the window's approved output as the starting preview; the context comes
// from the reflection itself.
func TestReflectionRefinementSeedsCurrentLens(t *testing.T) {
	app := testutil.NewApp(t)
	refl, current := scheduledReflection(t, app)

	created, _ := openRefinement(t, app, refl.Id, `{"clientId":"seed-1"}`)

	var sys, assistant *api.UIMessage
	for i := range created.Messages {
		switch created.Messages[i].Role {
		case "system":
			sys = &created.Messages[i]
		case "assistant":
			assistant = &created.Messages[i]
		}
	}
	if sys == nil || assistant == nil {
		t.Fatalf("seeded %d messages, want a system and an assistant turn", len(created.Messages))
	}
	_, spec, win := extractWindow(t, created.Messages)
	if !spec.WholeScope {
		t.Errorf("seeded context = %+v, want the reflection's own whole-scope spec", spec)
	}
	if win == nil || win.ID != current.ID {
		t.Errorf("seeded window = %+v, want the current window %s", win, current.ID)
	}
	parts := map[string]json.RawMessage{}
	for _, p := range assistant.Parts {
		parts[p.Type] = p.Data
	}
	if _, ok := parts[LensSeedPartType]; !ok {
		t.Error("seed turn lacks the lens_seed marker")
	}
	var lensCall struct {
		Input struct {
			Lens string `json:"lens"`
		} `json:"input"`
	}
	_ = json.Unmarshal(parts["tool-"+prompts.UpdateLensToolName], &lensCall)
	if lensCall.Input.Lens != "THE CURRENT LENS" {
		t.Errorf("seed lens = %q", lensCall.Input.Lens)
	}
	var applyCall struct {
		Input struct {
			Output string `json:"output"`
		} `json:"input"`
	}
	_ = json.Unmarshal(parts["tool-"+prompts.ApplyResultToolName], &applyCall)
	if applyCall.Input.Output != "THIS WEEK'S SUMMARY" {
		t.Errorf("seed preview = %q, want the window's approved output", applyCall.Input.Output)
	}

	// The lens-writer sees the current lens in its transcript.
	flat := llmcontext.Flatten(created.Messages)
	if len(flat) != 1 || !strings.Contains(flat[0].Content, "THE CURRENT LENS") || strings.Contains(flat[0].Content, "SUMMARY") {
		t.Errorf("flattened seed = %+v, want the lens echoed and the output hidden", flat)
	}
}

// A brand-new reflection has no lens to seed: the first turn drafts it.
func TestNewReflectionRefinementSeedsNoLens(t *testing.T) {
	app := testutil.NewApp(t)
	versions := engine.AppendWindowSpecVersion(nil, api.WindowSpec{Period: "168h", Duration: "168h"}, time.Now())
	refl := testutil.NewRecord(t, app, "reflection", map[string]any{
		"name": "fresh", "status": engine.EntityActive, "window_spec_versions": pbutil.JSONObject(versions),
	})
	created, _ := openRefinement(t, app, refl.Id, `{"clientId":"seed-2"}`)
	for _, m := range created.Messages {
		if m.Role == "assistant" {
			t.Fatalf("a new reflection was seeded with an assistant turn: %+v", m)
		}
	}
	_, _, win := extractWindow(t, created.Messages)
	if win == nil {
		t.Fatal("no trailing window seeded before the first grid point")
	}
}

// Sending only a new window re-applies the standing lens to it: one apply
// call against the new window, persisted as a turn that pairs the lens with
// the new output and stays out of the lens-writer's transcript.
func TestReflectionRefinementReappliesOnWindowChange(t *testing.T) {
	app := testutil.NewApp(t)
	refl, current := scheduledReflection(t, app)
	grid := engine.CurrentGridWindows(refl, time.Now())
	previous := grid[0]
	day := 24 * time.Hour
	eff, _ := time.Parse(time.RFC3339, previous.Start)
	dt := func(tm time.Time) types.DateTime { d, _ := types.ParseDateTime(tm); return d }
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "LAST WEEK", "source_time": dt(eff.Add(2 * day))})
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "THIS WEEK", "source_time": dt(eff.Add(9 * day))})

	_, refRec := openRefinement(t, app, refl.Id, `{"clientId":"reapply-1","window":{"start":"`+current.Start+`","end":"`+current.End+`"}}`)

	script := &refineScript{lens: "SHOULD NOT BE CALLED", applyOut: "LAST WEEK'S PREVIEW"}
	script.install(t)

	req := api.ChatRequest{ID: "reapply-1", Messages: []api.UIMessage{
		{ID: "sys-win", Role: "system", Parts: []api.UIMessagePart{{Type: "window", Data: raw(t, previous)}}},
	}}
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/chat", nil)
	e.Response = rec
	if err := HandleChatForRefinement(app, req, refRec)(e); err != nil {
		t.Fatalf("re-apply turn: %v", err)
	}

	script.mu.Lock()
	applies := append([]string(nil), script.applyCalls...)
	script.mu.Unlock()
	if len(applies) != 1 {
		t.Fatalf("apply calls = %d, want exactly one (and no drafting call)", len(applies))
	}
	if !strings.Contains(applies[0], "LAST WEEK") || strings.Contains(applies[0], "THIS WEEK") {
		t.Errorf("re-apply prompt is not scoped to the new window:\n%.300s", applies[0])
	}
	if !strings.Contains(applies[0], "THE CURRENT LENS") {
		t.Error("re-apply did not use the standing lens")
	}

	msgs, err := chat.LoadMessages(context.Background(), app, refRec)
	if err != nil {
		t.Fatal(err)
	}
	last := msgs[len(msgs)-1]
	if last.Role != "assistant" {
		t.Fatalf("last message role = %s", last.Role)
	}
	types := map[string]bool{}
	for _, p := range last.Parts {
		types[p.Type] = true
	}
	if !types[llmcontext.WindowReapplyPartType] || !types["tool-"+prompts.UpdateLensToolName] || !types["tool-"+prompts.ApplyResultToolName] {
		t.Errorf("re-apply turn parts = %v, want marker + lens + apply", types)
	}
	for _, m := range llmcontext.Flatten(msgs) {
		if strings.Contains(m.Content, "LAST WEEK'S PREVIEW") {
			t.Error("re-apply output leaked into the lens-writer transcript")
		}
	}
	if n := strings.Count(strings.Join(func() []string {
		var out []string
		for _, m := range llmcontext.Flatten(msgs) {
			out = append(out, m.Content)
		}
		return out
	}(), "\n"), "THE CURRENT LENS"); n != 1 {
		t.Errorf("lens echoed %d times in the transcript, want once (the seed)", n)
	}

	// A commit now installs the lens; the re-applied window's output is not published.
	lens, output, _, _, win, err := ExtractDraftedLensAndSpec(app, refRec)
	if err != nil || lens != "THE CURRENT LENS" || output != "LAST WEEK'S PREVIEW" || win == nil || win.ID != previous.ID {
		t.Errorf("commit payload = lens %q output %q win %+v (err %v)", lens, output, win, err)
	}
}

// After a lens commit every window's snapshot is lens-outdated: the series
// says so, and "generate all" regenerates them under the new lens.
func TestLensCommitMarksWindowsOutdated(t *testing.T) {
	app := testutil.NewApp(t)
	refl, current := scheduledReflection(t, app)
	newLens := testutil.NewRecord(t, app, "lens", map[string]any{"prompt": pbutil.JSONString("NEW")})
	refl.Set("current_lens_id", newLens.Id)
	if err := app.Save(refl); err != nil {
		t.Fatal(err)
	}

	rec, err := callJSON(t, app, HandleListReflectionWindows(app), "GET", "/api/reflections/x/windows", "", map[string]string{"id": refl.Id})
	if err != nil {
		t.Fatal(err)
	}
	var series api.ReflectionWindowsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &series)
	var found bool
	for _, w := range series.Windows {
		if w.ID == current.ID {
			found = true
			if !w.LensOutdated {
				t.Error("window with an old-lens snapshot not marked lensOutdated")
			}
		}
	}
	if !found {
		t.Fatal("current window missing from the series")
	}

	st, _ := entityStatus(context.Background(), app, refl.Id)
	windows, herr := reflectionWindowsToGenerate(&core.RequestEvent{App: app}, app, refl, api.GenerateSnapshotRequest{All: true}, st)
	if herr != nil {
		t.Fatal(herr)
	}
	if len(windows) != 2 {
		t.Fatalf("generate all covers %d windows, want the pending one and the lens-outdated one", len(windows))
	}
}
