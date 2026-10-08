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

func postArchiveFragments(t *testing.T, app core.App, archive bool, body string) []string {
	t.Helper()
	rec := httptest.NewRecorder()
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/fragments/archive", strings.NewReader(body))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Response = rec
	if err := HandleArchiveFragments(app, archive)(e); err != nil {
		t.Fatalf("archive fragments: %v", err)
	}
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.IDs
}

func TestArchiveFragmentsBulk(t *testing.T) {
	app := testutil.NewApp(t)
	a := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "a"})
	b := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "b"})
	keep := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "keep"})
	gone := testutil.NewRecord(t, app, "fragment", map[string]any{"type": "note", "content": "gone"})
	gone.Set("deleted_at", "2026-01-01 00:00:00.000Z")
	if err := app.Save(gone); err != nil {
		t.Fatal(err)
	}

	archived := func(id string) bool {
		t.Helper()
		r, err := app.FindRecordById("fragment", id)
		if err != nil {
			t.Fatal(err)
		}
		return !r.GetDateTime("archived_at").IsZero()
	}

	body := `{"ids":["` + a.Id + `","` + b.Id + `","` + gone.Id + `","missing"]}`
	if got := postArchiveFragments(t, app, true, body); strings.Join(got, ",") != a.Id+","+b.Id {
		t.Errorf("changed %v", got)
	}
	if !archived(a.Id) || !archived(b.Id) || archived(keep.Id) || archived(gone.Id) {
		t.Errorf("archived a=%v b=%v keep=%v gone=%v", archived(a.Id), archived(b.Id), archived(keep.Id), archived(gone.Id))
	}

	if got := postArchiveFragments(t, app, true, body); len(got) != 0 {
		t.Errorf("second archive changed %v", got)
	}

	if got := postArchiveFragments(t, app, false, `{"ids":["`+a.Id+`","`+keep.Id+`"]}`); strings.Join(got, ",") != a.Id {
		t.Errorf("unarchive changed %v", got)
	}
	if archived(a.Id) || !archived(b.Id) {
		t.Errorf("after unarchive a=%v b=%v", archived(a.Id), archived(b.Id))
	}
}

func TestArchiveFragmentsRequiresIDs(t *testing.T) {
	app := testutil.NewApp(t)
	e := &core.RequestEvent{App: app}
	e.Request = httptest.NewRequest("POST", "/api/fragments/archive", strings.NewReader(`{"ids":[]}`))
	e.Request.Header.Set("Content-Type", "application/json")
	e.Response = httptest.NewRecorder()
	if err := HandleArchiveFragments(app, true)(e); err == nil {
		t.Fatal("want error for empty ids")
	}
}
