// Package pbtest boots a real PocketBase instance against a temporary directory
// so tests can exercise code that talks to collections, rather than mocking the
// database out from under it.
package pbtest

import (
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	_ "github.com/north-shore-software/kalaido/kalaidoscope/migrations"
)

// NewApp boots a throwaway PocketBase against a temp data dir and applies the
// schema migration, so tests run against the real collections.
func NewApp(t *testing.T) core.App {
	t.Helper()

	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:  t.TempDir(),
		HideStartBanner: true,
	})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })

	if err := app.RunAppMigrations(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return app
}

// NewRecord creates and saves one record, failing the test if it won't save.
func NewRecord(t *testing.T, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()

	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find collection %q: %v", collection, err)
	}
	rec := core.NewRecord(col)
	for k, v := range values {
		rec.Set(k, v)
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return rec
}
