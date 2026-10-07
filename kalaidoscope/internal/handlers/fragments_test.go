package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func TestRenameFragmentSetsTitleAndStreamShowsIt(t *testing.T) {
	app := testutil.NewApp(t)
	frag := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "a note"})

	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("PATCH", "/api/fragments/"+frag.Id, strings.NewReader(`{"title":"  My name  "}`))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Request.SetPathValue("id", frag.Id)
	e.Response = rec
	if err := HandleRenameFragment(app)(e); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["title"] != "My name" {
		t.Errorf("response title %q", out["title"])
	}
	got, err := app.FindRecordById("fragment", frag.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetString("title") != "My name" {
		t.Errorf("stored title %q", got.GetString("title"))
	}
	view, err := app.FindRecordById("view_stream", frag.Id)
	if err != nil {
		t.Fatal(err)
	}
	if view.GetString("title") != "My name" {
		t.Errorf("view title %q", view.GetString("title"))
	}
}
