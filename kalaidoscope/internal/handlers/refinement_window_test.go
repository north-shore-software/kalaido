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
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
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

	// Commit files the snapshot under the window.
	rec = httptest.NewRecorder()
	e = &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/reflections/"+refl.Id+"/refinements/"+refRec.Id+"/commit", nil)
	e.Request.SetPathValue("id", refl.Id)
	e.Request.SetPathValue("rid", refRec.Id)
	e.Response = rec
	if err := HandleCommitReflectionRefinement(app)(e); err != nil {
		t.Fatalf("commit: %v", err)
	}
	var committed struct {
		SnapshotID string `json:"snapshotId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &committed); err != nil || committed.SnapshotID == "" {
		t.Fatalf("commit response %s (err %v)", rec.Body.String(), err)
	}
	snap, err := app.FindRecordById("reflection_snapshot", committed.SnapshotID)
	if err != nil {
		t.Fatal(err)
	}
	if got := snap.GetString("window_key"); got != wantStart+"_"+wantEnd {
		t.Errorf("window_key = %q, want %q", got, wantStart+"_"+wantEnd)
	}
	var rw map[string]string
	_ = snap.UnmarshalJSONField("resolved_window", &rw)
	if rw["start"] != wantStart || rw["end"] != wantEnd {
		t.Errorf("resolved_window = %v, want [%s, %s)", rw, wantStart, wantEnd)
	}
	if got := snap.GetInt("window_spec_version_number"); got != 1 {
		t.Errorf("window_spec_version_number = %d, want 1", got)
	}
	var ws api.WindowSpec
	_ = snap.UnmarshalJSONField("window_spec", &ws)
	if ws.Period != "168h" {
		t.Errorf("window_spec = %+v, want the governing schedule", ws)
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
