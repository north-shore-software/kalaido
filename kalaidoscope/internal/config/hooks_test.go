package config

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
)

func authRecord(t *testing.T, app core.App, collection, email string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.SetEmail(email)
	rec.SetPassword("correct horse battery staple")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

// The API key never leaves the server for an app user; a superuser (the
// dashboard) still sees it.
func TestAPIKeyHiddenFromAppUsers(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterHooks(app)
	user := authRecord(t, app, "users", "user@example.test")
	super := authRecord(t, app, core.CollectionNameSuperusers, "admin@example.test")

	enrich := func(auth *core.Record) map[string]any {
		rec := testutil.NewRecord(t, app, CollectionName, map[string]any{"api_key": "sk-secret"})
		ev := &core.RecordEnrichEvent{App: app, RequestInfo: &core.RequestInfo{Auth: auth}}
		ev.Record = rec
		if err := app.OnRecordEnrich(CollectionName).Trigger(ev); err != nil {
			t.Fatal(err)
		}
		return rec.PublicExport()
	}

	if _, ok := enrich(user)["api_key"]; ok {
		t.Error("api_key exported to an app user")
	}
	if _, ok := enrich(nil)["api_key"]; ok {
		t.Error("api_key exported to an anonymous request")
	}
	if got, _ := enrich(super)["api_key"].(string); got != "sk-secret" {
		t.Errorf("superuser api_key = %q, want the stored key", got)
	}
}

// has_api_key tells the app whether a key is stored without exporting it.
func TestHasAPIKeyExported(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterHooks(app)
	user := authRecord(t, app, "users", "user@example.test")

	enrich := func(key string) map[string]any {
		rec := testutil.NewRecord(t, app, CollectionName, map[string]any{"api_key": key})
		ev := &core.RecordEnrichEvent{App: app, RequestInfo: &core.RequestInfo{Auth: user}}
		ev.Record = rec
		if err := app.OnRecordEnrich(CollectionName).Trigger(ev); err != nil {
			t.Fatal(err)
		}
		return rec.PublicExport()
	}

	if got, _ := enrich("sk-secret")["has_api_key"].(bool); !got {
		t.Error("has_api_key = false with a stored key")
	}
	if got, ok := enrich("")["has_api_key"].(bool); !ok || got {
		t.Errorf("has_api_key = %v (present %v) with no key, want false", got, ok)
	}
}
