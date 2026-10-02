package handlers

import (
	"archive/zip"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/backup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func writeTestZip(t *testing.T, targetPath string, files map[string][]byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()

	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(content); err != nil {
			t.Fatal(err)
		}
	}
}

func mustMarshalJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestListAndCreateBackups(t *testing.T) {
	app := testutil.NewApp(t)
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{Origin: "local"})
	backup.Install(app, eng)

	// List initial (empty)
	rec, err := callJSON(t, app, HandleListBackups(app, eng), http.MethodGet, "/api/kalaidoscope/backups", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", rec.Code)
	}
	var list []backup.Summary
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("expected 0 backups, got %d", len(list))
	}

	// Create backup
	rec, err = callJSON(t, app, HandleCreateBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", rec.Code)
	}
	var created backup.Summary
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Kind != backup.KindManual {
		t.Fatalf("unexpected created backup: %+v", created)
	}

	// List again
	rec, err = callJSON(t, app, HandleListBackups(app, eng), http.MethodGet, "/api/kalaidoscope/backups", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", rec.Code)
	}
	list = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != created.ID {
		t.Fatalf("expected 1 backup with ID %s, got %+v", created.ID, list)
	}
}

func TestDownloadBackupHeadersAnd404(t *testing.T) {
	app := testutil.NewApp(t)
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{Origin: "local"})
	backup.Install(app, eng)

	created, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	// 404 on bad id format
	_, err = callJSON(t, app, HandleDownloadBackup(app, eng), http.MethodGet, "/api/kalaidoscope/backups/invalid.zip/download", "", map[string]string{"id": "invalid.zip"})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Fatalf("download invalid id status = %d, want 404", code)
	}

	// 404 on non-existent id
	_, err = callJSON(t, app, HandleDownloadBackup(app, eng), http.MethodGet, "/api/kalaidoscope/backups/manual-20261001T120000Z.zip/download", "", map[string]string{"id": "manual-20261001T120000Z.zip"})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Fatalf("download missing id status = %d, want 404", code)
	}

	// Successful download with headers
	rec, err := callJSON(t, app, HandleDownloadBackup(app, eng), http.MethodGet, "/api/kalaidoscope/backups/"+created.ID+"/download", "", map[string]string{"id": created.ID})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("download status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("Content-Type = %q, want application/zip", ct)
	}
	if cl := rec.Header().Get("Content-Length"); cl == "" || cl == "0" {
		t.Fatalf("Content-Length = %q, want non-empty", cl)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != "attachment; filename=\""+created.ID+"\"" {
		t.Fatalf("Content-Disposition = %q, want filename attachment", cd)
	}
}

func TestRestoreBackupRoutesAndStatus(t *testing.T) {
	app := testutil.NewApp(t)
	backupsDir := filepath.Join(app.DataDir(), "backups")
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{
		Origin: "local",
		Lifecycle: backup.Lifecycle{
			Restart: func() error { return nil },
		},
	})
	backup.Install(app, eng)

	// 404 on bad id format
	_, err := callJSON(t, app, HandleRestoreBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups/invalid.zip/restore", "", map[string]string{"id": "invalid.zip"})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Fatalf("restore invalid id status = %d, want 404", code)
	}

	// 404 on non-existent id
	_, err = callJSON(t, app, HandleRestoreBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups/manual-20261001T120000Z.zip/restore", "", map[string]string{"id": "manual-20261001T120000Z.zip"})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Fatalf("restore missing id status = %d, want 404", code)
	}

	// 422 on newer schema
	newerZip := "manual-20261001T120001Z.zip"
	writeTestZip(t, filepath.Join(backupsDir, newerZip), map[string][]byte{
		backup.ManifestName: mustMarshalJSON(t, backup.Manifest{
			Version:       1,
			SchemaVersion: schema.Version + 1,
			Kind:          backup.KindManual,
		}),
	})
	_, err = callJSON(t, app, HandleRestoreBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups/"+newerZip+"/restore", "", map[string]string{"id": newerZip})
	if code := apiErrorStatus(err); code != http.StatusUnprocessableEntity {
		t.Fatalf("restore newer schema status = %d, want 422", code)
	}

	// 400 on no manifest
	noManifestZip := "manual-20261001T120002Z.zip"
	writeTestZip(t, filepath.Join(backupsDir, noManifestZip), map[string][]byte{
		"data.db": []byte("empty"),
	})
	_, err = callJSON(t, app, HandleRestoreBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups/"+noManifestZip+"/restore", "", map[string]string{"id": noManifestZip})
	if code := apiErrorStatus(err); code != http.StatusBadRequest {
		t.Fatalf("restore no manifest status = %d, want 400", code)
	}

	// 409 while busy
	created, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	app.Store().Set(core.StoreKeyActiveBackup, "some_operation")
	_, err = callJSON(t, app, HandleRestoreBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups/"+created.ID+"/restore", "", map[string]string{"id": created.ID})
	if code := apiErrorStatus(err); code != http.StatusConflict {
		t.Fatalf("restore while busy status = %d, want 409", code)
	}
	app.Store().Remove(core.StoreKeyActiveBackup)
	RestoreDelay = 0
	defer func() { RestoreDelay = 1 * time.Second }()

	// 202 Accepted on valid restore
	rec, err := callJSON(t, app, HandleRestoreBackup(app, eng), http.MethodPost, "/api/kalaidoscope/backups/"+created.ID+"/restore", "", map[string]string{"id": created.ID})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusAccepted {
		t.Fatalf("restore status = %d, want 202", rec.Code)
	}

	// Wait for fire-and-forget Apply to complete to avoid leaking goroutines in testutil
	for attempt := 0; attempt < 50; attempt++ {
		outcome, _ := eng.LastRestore()
		if outcome != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRestoreStatusRoute(t *testing.T) {
	app := testutil.NewApp(t)
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{
		Origin: "local",
		Lifecycle: backup.Lifecycle{
			Restart: func() error { return nil },
		},
	})
	backup.Install(app, eng)

	// Status initially has boot_id and nil last_restore
	rec, err := callJSON(t, app, HandleRestoreStatus(app, eng), http.MethodGet, "/api/kalaidoscope/backups/restore-status", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("restore-status code = %d, want 200", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	bootID, ok := res["boot_id"].(string)
	if !ok || bootID == "" {
		t.Fatalf("expected non-empty boot_id, got %v", res["boot_id"])
	}
	if res["last_restore"] != nil {
		t.Fatalf("expected nil last_restore initially, got %v", res["last_restore"])
	}

	// Apply a backup so an outcome is recorded
	sum, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}
	if err := eng.Apply(context.Background(), sum.ID); err != nil {
		t.Fatal(err)
	}

	// Status now reports outcome
	rec, err = callJSON(t, app, HandleRestoreStatus(app, eng), http.MethodGet, "/api/kalaidoscope/backups/restore-status", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("restore-status code = %d, want 200", rec.Code)
	}
	res = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res["boot_id"] != bootID {
		t.Fatalf("boot_id changed without restart: got %v, want %v", res["boot_id"], bootID)
	}
	lastRestore, ok := res["last_restore"].(map[string]any)
	if !ok {
		t.Fatalf("expected last_restore map, got %v", res["last_restore"])
	}
	if lastRestore["id"] != sum.ID || lastRestore["ok"] != true {
		t.Fatalf("unexpected last_restore: %+v", lastRestore)
	}
}

func TestDeleteBackup(t *testing.T) {
	app := testutil.NewApp(t)
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{Origin: "local"})
	backup.Install(app, eng)

	created, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	// 404 on bad id
	_, err = callJSON(t, app, HandleDeleteBackup(app, eng), http.MethodDelete, "/api/kalaidoscope/backups/bad.zip", "", map[string]string{"id": "bad.zip"})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Fatalf("delete bad id status = %d, want 404", code)
	}

	// 204 on success
	rec, err := callJSON(t, app, HandleDeleteBackup(app, eng), http.MethodDelete, "/api/kalaidoscope/backups/"+created.ID, "", map[string]string{"id": created.ID})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rec.Code)
	}

	// 404 on already deleted
	_, err = callJSON(t, app, HandleDeleteBackup(app, eng), http.MethodDelete, "/api/kalaidoscope/backups/"+created.ID, "", map[string]string{"id": created.ID})
	if code := apiErrorStatus(err); code != http.StatusNotFound {
		t.Fatalf("delete non-existent id status = %d, want 404", code)
	}
}
