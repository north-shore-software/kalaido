package handlers

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/explore"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/llm"
)

func bookmark(t *testing.T, app core.App, convID, msgID string, on bool) (int, api.MessageMark) {
	t.Helper()
	body := `{"bookmarked":false}`
	if on {
		body = `{"bookmarked":true}`
	}
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("PATCH", "/api/explore/conversations/"+convID+"/messages/"+msgID+"/bookmark", strings.NewReader(body))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Request.SetPathValue("cid", convID)
	e.Request.SetPathValue("mid", msgID)
	e.Response = rec
	if err := HandleBookmarkMessage(app)(e); err != nil {
		return apiErrorStatus(err), api.MessageMark{}
	}
	var mark api.MessageMark
	if err := json.Unmarshal(rec.Body.Bytes(), &mark); err != nil {
		t.Fatal(err)
	}
	return rec.Code, mark
}

// Both turns of a plain chat can be bookmarked by their UIMessage id, the
// mark persists on the row, and clearing it leaves the row in place.
func TestBookmarkMessageMarksBothRoles(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "a note"})
	(&exploreScript{}).install(t)
	if _, err := runExploreTurn(t, app, "conv-bm", &api.ContextSpec{WholeScope: api.WholeScopeFull}, "keep this"); err != nil {
		t.Fatal(err)
	}
	msgs := persistedExplore(t, app, "conv-bm")
	var userID, assistantID string
	for _, m := range msgs {
		switch m.Role {
		case "user":
			userID = m.ID
		case "assistant":
			assistantID = m.ID
		}
	}
	if userID == "" || assistantID == "" {
		t.Fatalf("expected a user and an assistant row, got %+v", msgs)
	}

	for _, id := range []string{userID, assistantID} {
		code, mark := bookmark(t, app, "conv-bm", id, true)
		if code != 200 || !mark.Bookmarked || mark.MessageID != id || mark.FragmentID != "" {
			t.Errorf("bookmark %s: code %d mark %+v", id, code, mark)
		}
	}
	conv, _ := explore.FindConversation(app, "conv-bm")
	rec, err := explore.FindMessage(app, conv, assistantID)
	if err != nil || !rec.GetBool("bookmarked") {
		t.Errorf("assistant row not marked: %v %v", err, rec)
	}

	code, mark := bookmark(t, app, "conv-bm", userID, false)
	if code != 200 || mark.Bookmarked {
		t.Errorf("clear: code %d mark %+v", code, mark)
	}
}

// What cannot be bookmarked: an unknown message, a system (context) message,
// a chat that has never sent, and a refinement's transcript.
func TestBookmarkMessageRefusals(t *testing.T) {
	app := testutil.NewApp(t)
	(&exploreScript{}).install(t)
	if _, err := runExploreTurn(t, app, "conv-ref", &api.ContextSpec{WholeScope: api.WholeScopeFull}, "hi"); err != nil {
		t.Fatal(err)
	}

	if code, _ := bookmark(t, app, "conv-ref", "nope", true); code != 404 {
		t.Errorf("unknown message: %d, want 404", code)
	}
	if code, _ := bookmark(t, app, "conv-ref", "conv-ref-spec", true); code != 422 {
		t.Errorf("system message: %d, want 422", code)
	}
	if code, _ := bookmark(t, app, "never-sent", "conv-ref-user", true); code != 404 {
		t.Errorf("unknown conversation: %d, want 404", code)
	}

	proj := testutil.NewRecord(t, app, "projection", map[string]any{"name": "P", "status": "active"})
	testutil.NewRecord(t, app, "projection_refinement", map[string]any{
		"projection_id": proj.Id, "external_conversation_id": "ref-1", "status": "open",
	})
	if code, _ := bookmark(t, app, "ref-1", "conv-ref-user", true); code != 404 {
		t.Errorf("refinement conversation: %d, want 404", code)
	}
}

func saveBookmarks(t *testing.T, app core.App, convID string) (int, api.SaveBookmarksResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/explore/conversations/"+convID+"/bookmarks/save", nil)
	e.Request.SetPathValue("cid", convID)
	e.Response = rec
	if err := HandleSaveBookmarks(app)(e); err != nil {
		return apiErrorStatus(err), api.SaveBookmarksResponse{}
	}
	var res api.SaveBookmarksResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return rec.Code, res
}

func countFragments(t *testing.T, app core.App) int {
	t.Helper()
	recs, err := app.FindRecordsByFilter("fragment", "type = 'chat'", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	return len(recs)
}

// Saving turns every bookmarked turn into one chat fragment with the turn's
// own provenance and time; a second save reuses them; a turn whose fragment
// was since deleted gets a fresh one; a cleared bookmark keeps its fragment.
func TestSaveBookmarksIsIdempotent(t *testing.T) {
	app := testutil.NewApp(t)
	(&exploreScript{}).install(t)
	mention := "look at @[Fragment:abc123|standup notes] please"
	if _, err := runExploreTurn(t, app, "conv-save", &api.ContextSpec{WholeScope: api.WholeScopeFull}, mention); err != nil {
		t.Fatal(err)
	}
	var userID, assistantID string
	for _, m := range persistedExplore(t, app, "conv-save") {
		switch m.Role {
		case "user":
			userID = m.ID
		case "assistant":
			assistantID = m.ID
		}
	}

	// Nothing bookmarked: an empty, successful save.
	if code, res := saveBookmarks(t, app, "conv-save"); code != 200 || len(res.Saved) != 0 {
		t.Fatalf("empty save: %d %+v", code, res)
	}

	bookmark(t, app, "conv-save", userID, true)
	bookmark(t, app, "conv-save", assistantID, true)
	code, first := saveBookmarks(t, app, "conv-save")
	if code != 200 || len(first.Saved) != 2 {
		t.Fatalf("first save: %d %+v", code, first)
	}
	byMsg := map[string]api.SavedBookmark{}
	for _, s := range first.Saved {
		if !s.Created || s.FragmentID == "" {
			t.Errorf("first save should create: %+v", s)
		}
		byMsg[s.MessageID] = s
	}
	if countFragments(t, app) != 2 {
		t.Errorf("fragments = %d, want 2", countFragments(t, app))
	}

	frag, err := app.FindRecordById("fragment", byMsg[userID].FragmentID)
	if err != nil {
		t.Fatal(err)
	}
	if frag.GetString("content") != "look at @standup notes please" {
		t.Errorf("mention not stripped: %q", frag.GetString("content"))
	}
	if frag.GetString("source") != "explore:conv-save:"+userID || frag.GetString("type") != "chat" || frag.GetString("ingested_via") != "app" {
		t.Errorf("provenance: source=%q type=%q via=%q", frag.GetString("source"), frag.GetString("type"), frag.GetString("ingested_via"))
	}
	conv, _ := explore.FindConversation(app, "conv-save")
	row, _ := explore.FindMessage(app, conv, userID)
	if row.GetString("fragment_id") != frag.Id {
		t.Errorf("row not stamped: %q", row.GetString("fragment_id"))
	}
	if !frag.GetDateTime("occurred_at").Equal(row.GetDateTime("created")) {
		t.Errorf("occurred_at %v, want the turn's created %v", frag.GetDateTime("occurred_at"), row.GetDateTime("created"))
	}
	if _, mark := bookmark(t, app, "conv-save", userID, false); mark.FragmentID != frag.Id {
		t.Errorf("clearing the bookmark lost the fragment: %+v", mark)
	}

	// Second save: the assistant turn is still bookmarked and already saved.
	code, second := saveBookmarks(t, app, "conv-save")
	if code != 200 || len(second.Saved) != 1 || second.Saved[0].Created || second.Saved[0].FragmentID != byMsg[assistantID].FragmentID {
		t.Errorf("second save: %d %+v", code, second)
	}
	if countFragments(t, app) != 2 {
		t.Errorf("fragments after re-save = %d, want 2", countFragments(t, app))
	}

	// Soft-delete the assistant's fragment: the next save makes a new one.
	afrag, _ := app.FindRecordById("fragment", byMsg[assistantID].FragmentID)
	afrag.Set("deleted_at", types.NowDateTime())
	if err := app.Save(afrag); err != nil {
		t.Fatal(err)
	}
	_, third := saveBookmarks(t, app, "conv-save")
	if len(third.Saved) != 1 || !third.Saved[0].Created || third.Saved[0].FragmentID == afrag.Id {
		t.Errorf("save after delete: %+v", third)
	}

	if code, _ := saveBookmarks(t, app, "never-sent"); code != 404 {
		t.Errorf("unknown conversation: %d, want 404", code)
	}
}

// briefScript answers the brief call with a propose_brief tool call when the
// tool is offered (recording the transcript it saw), and with plain text
// when told to skip the tool.
type briefScript struct {
	mu       sync.Mutex
	noTool   bool
	window   int
	prompts  []string
	toolSeen bool
}

func (s *briefScript) install(t *testing.T) {
	t.Helper()
	llm.SetActiveModelSet(llm.SetLocal)
	llm.SetProviderFactory(func(model string, cfg llm.WorkspaceConfig) llm.Provider {
		return briefScriptProvider{s}
	})
}

type briefScriptProvider struct{ s *briefScript }

func (p briefScriptProvider) ContextWindow() int {
	if p.s.window > 0 {
		return p.s.window
	}
	return 256_000
}

func (p briefScriptProvider) Stream(ctx context.Context, msgs []llm.Message, tools []llm.Tool, opts llm.GenOptions) (*llm.Completion, error) {
	p.s.mu.Lock()
	defer p.s.mu.Unlock()
	ch := make(chan llm.StreamEvent, 8)
	offered := false
	for _, t := range tools {
		if t.Name == prompts.ProposeBriefToolName {
			offered = true
		}
	}
	if offered {
		p.s.toolSeen = true
		p.s.prompts = append(p.s.prompts, msgs[len(msgs)-1].Content)
	}
	if offered && !p.s.noTool {
		args, _ := json.Marshal(map[string]string{"name": "Lift contract", "message": "Keep a running account of the lift contract."})
		ch <- llm.StreamEvent{Kind: llm.EventToolStart, ToolCallID: "tc-b", ToolName: prompts.ProposeBriefToolName}
		ch <- llm.StreamEvent{Kind: llm.EventToolEnd, ToolCallID: "tc-b", ToolName: prompts.ProposeBriefToolName, Args: args}
	} else if offered {
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: "  Keep the lift contract current.  "}
	} else {
		ch <- llm.StreamEvent{Kind: llm.EventText, Text: "THE ANSWER"}
	}
	close(ch)
	return &llm.Completion{Events: ch, Wait: func() *llm.Usage { return nil }}, nil
}

func requestBrief(t *testing.T, app core.App, convID string) (int, api.BriefResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/explore/conversations/"+convID+"/brief", nil)
	e.Request.SetPathValue("cid", convID)
	e.Response = rec
	if err := HandleExploreBrief(app)(e); err != nil {
		return apiErrorStatus(err), api.BriefResponse{}
	}
	var res api.BriefResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return rec.Code, res
}

// The brief call sees the whole conversation with the bookmarked turns
// marked and mentions stripped, and returns the tool call's name and
// message; without a tool call the answer text stands in as the message.
func TestExploreBriefFromBookmarks(t *testing.T) {
	app := testutil.NewApp(t)
	script := &briefScript{}
	script.install(t)
	if _, err := runExploreTurn(t, app, "conv-brief", &api.ContextSpec{WholeScope: api.WholeScopeFull}, "about @[Fragment:abc123|the lift] contract"); err != nil {
		t.Fatal(err)
	}
	var assistantID string
	for _, m := range persistedExplore(t, app, "conv-brief") {
		if m.Role == "assistant" {
			assistantID = m.ID
		}
	}
	bookmark(t, app, "conv-brief", assistantID, true)

	code, brief := requestBrief(t, app, "conv-brief")
	if code != 200 || brief.Name != "Lift contract" || brief.Message != "Keep a running account of the lift contract." {
		t.Fatalf("brief: %d %+v", code, brief)
	}
	if len(script.prompts) != 1 {
		t.Fatalf("brief calls = %d, want 1", len(script.prompts))
	}
	got := script.prompts[0]
	if !strings.Contains(got, "user:\nabout @the lift contract") {
		t.Errorf("user turn not rendered with mention stripped:\n%s", got)
	}
	if !strings.Contains(got, "assistant "+prompts.BookmarkedMarker+":\nTHE ANSWER") {
		t.Errorf("assistant turn not marked bookmarked:\n%s", got)
	}
	if strings.Contains(got, "user "+prompts.BookmarkedMarker) {
		t.Errorf("unbookmarked user turn marked:\n%s", got)
	}

	script.noTool = true
	code, brief = requestBrief(t, app, "conv-brief")
	if code != 200 || brief.Name != "" || brief.Message != "Keep the lift contract current." {
		t.Errorf("text fallback: %d %+v", code, brief)
	}

	if code, _ := requestBrief(t, app, "never-sent"); code != 404 {
		t.Errorf("unknown conversation: %d, want 404", code)
	}
}

// An oversized conversation is refused the way an explore turn is.
func TestExploreBriefRefusesOversized(t *testing.T) {
	app := testutil.NewApp(t)
	script := &briefScript{}
	script.install(t)
	if _, err := runExploreTurn(t, app, "conv-big", &api.ContextSpec{}, strings.Repeat("word ", 20)); err != nil {
		t.Fatal(err)
	}
	// The window shrinks under the brief call alone.
	script.window = 200
	if code, _ := requestBrief(t, app, "conv-big"); code != 422 {
		t.Errorf("oversized brief: %d, want 422", code)
	}
}

// A projection created with a description keeps it; without one it stays empty.
func TestCreateProjectionWithDescription(t *testing.T) {
	app := testutil.NewApp(t)
	create := func(body string) string {
		rec := httptest.NewRecorder()
		e := &core.RequestEvent{App: app}
		e.Request = httptest.NewRequest("POST", "/api/projections", strings.NewReader(body))
		e.Request.Header.Set("Content-Type", "application/json")
		e.Response = rec
		if err := HandleCreateProjection(app)(e); err != nil {
			t.Fatal(err)
		}
		var res api.CreateProjectionResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
		return res.ProjectionID
	}
	withID := create(`{"name":"Lifts","description":"  Keep the lift contract current. "}`)
	rec, err := app.FindRecordById("projection", withID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.GetString("description") != "Keep the lift contract current." {
		t.Errorf("description = %q", rec.GetString("description"))
	}
	plainID := create(`{"name":"Plain"}`)
	plain, _ := app.FindRecordById("projection", plainID)
	if plain.GetString("description") != "" {
		t.Errorf("plain description = %q, want empty", plain.GetString("description"))
	}
}
