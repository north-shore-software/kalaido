package backup_test

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/north-shore-software/kalaido/kalaidoscope/backup"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/testutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

func TestFilenameAndParseFilename(t *testing.T) {
	now := time.Now().UTC()
	kinds := []backup.Kind{
		backup.KindManual,
		backup.KindScheduled,
		backup.KindPreRestore,
	}

	for _, k := range kinds {
		fn := backup.Filename(k, now)
		parsedK, parsedT, ok := backup.ParseFilename(fn)
		if !ok {
			t.Fatalf("failed to parse valid filename: %s", fn)
		}
		if parsedK != k {
			t.Fatalf("kind mismatch: got %v, want %v", parsedK, k)
		}
		if !parsedT.Equal(now.Truncate(time.Second)) {
			t.Fatalf("time mismatch: got %v, want %v", parsedT, now.Truncate(time.Second))
		}
	}

	rejects := []string{
		"foo.zip",
		"manual-notadate.zip",
		"pre-migration-v5-1.db",
		"manual-20261001T203000Z.zip.attrs",
		"../manual-20261001T203000Z.zip",
		"/manual-20261001T203000Z.zip",
		"subdir/manual-20261001T203000Z.zip",
	}

	for _, rej := range rejects {
		if _, _, ok := backup.ParseFilename(rej); ok {
			t.Fatalf("expected rejection for %s", rej)
		}
	}
}

func TestCreateExcludesMigrationFailed(t *testing.T) {
	app := testutil.NewApp(t)

	failedPath := filepath.Join(app.DataDir(), "schema-migration-failed.json")
	if err := os.WriteFile(failedPath, []byte(`{"failed":true}`), 0o644); err != nil {
		t.Fatal(err)
	}

	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{Origin: "test-origin"})
	backup.Install(app, eng)

	sum, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	zipPath := filepath.Join(app.DataDir(), "backups", sum.ID)
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()

	names := make(map[string]bool)
	for _, f := range zr.File {
		names[f.Name] = true
	}

	if !names["data.db"] {
		t.Fatal("missing data.db in archive")
	}
	if !names["auxiliary.db"] {
		t.Fatal("missing auxiliary.db in archive")
	}
	if !names[backup.ManifestName] {
		t.Fatal("missing backup-manifest.json in archive")
	}
	if names["schema-migration-failed.json"] {
		t.Fatal("archive contains schema-migration-failed.json")
	}

	m, err := backup.ReadManifest(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != 1 {
		t.Fatalf("got version %d, want 1", m.Version)
	}
	if m.SchemaVersion != schema.Version {
		t.Fatalf("got schema version %d, want %d", m.SchemaVersion, schema.Version)
	}
	if m.Kind != backup.KindManual {
		t.Fatalf("got kind %s, want %s", m.Kind, backup.KindManual)
	}
	if m.Origin != "test-origin" {
		t.Fatalf("got origin %s, want test-origin", m.Origin)
	}
	if m.BuildRev == "" {
		t.Fatal("got empty build_rev, want non-empty")
	}
}

func TestListAndDelete(t *testing.T) {
	app := testutil.NewApp(t)
	backupsDir := filepath.Join(app.DataDir(), "backups")
	if err := os.MkdirAll(backupsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	planted := filepath.Join(backupsDir, "pre-migration-v5-1.db")
	if err := os.WriteFile(planted, []byte("db content"), 0o644); err != nil {
		t.Fatal(err)
	}

	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{Origin: "local"})
	backup.Install(app, eng)

	created, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	sums, err := eng.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sums) != 1 {
		t.Fatalf("got %d summaries, want 1", len(sums))
	}
	if sums[0].ID != created.ID {
		t.Fatalf("got ID %s, want %s", sums[0].ID, created.ID)
	}

	if err := eng.Delete(context.Background(), created.ID); err != nil {
		t.Fatal(err)
	}

	sumsAfter, err := eng.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(sumsAfter) != 0 {
		t.Fatalf("got %d summaries, want 0", len(sumsAfter))
	}
}

func TestPrepare(t *testing.T) {
	app := testutil.NewApp(t)
	backupsDir := filepath.Join(app.DataDir(), "backups")
	if err := os.MkdirAll(backupsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{Origin: "local"})
	backup.Install(app, eng)

	newerZip := "manual-20261001T203001Z.zip"
	writeZip(t, filepath.Join(backupsDir, newerZip), map[string][]byte{
		backup.ManifestName: mustMarshal(t, backup.Manifest{
			Version:       1,
			SchemaVersion: schema.Version + 1,
			Kind:          backup.KindManual,
		}),
	})

	err := eng.Prepare(context.Background(), newerZip)
	if !errors.Is(err, backup.ErrSchemaNewer) {
		t.Fatalf("got %v, want ErrSchemaNewer", err)
	}

	noManifestZip := "manual-20261001T203002Z.zip"
	writeZip(t, filepath.Join(backupsDir, noManifestZip), map[string][]byte{
		"data.db": []byte("empty"),
	})

	err = eng.Prepare(context.Background(), noManifestZip)
	if !errors.Is(err, backup.ErrNotKalaidoBackup) {
		t.Fatalf("got %v, want ErrNotKalaidoBackup", err)
	}

	realSum, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	if err := eng.Prepare(context.Background(), realSum.ID); err != nil {
		t.Fatal(err)
	}

	// Prepare does not create pre-restore snapshot; Apply does.
	sums, err := eng.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range sums {
		if s.Kind == backup.KindPreRestore {
			t.Fatal("pre-restore backup should not be created by Prepare")
		}
	}
}

func TestApply(t *testing.T) {
	app := testutil.NewApp(t)

	restarts := 0
	drains := 0
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{
		Origin: "local",
		Lifecycle: backup.Lifecycle{
			Drain: func() {
				drains++
			},
			Restart: func() error {
				restarts++
				return nil
			},
		},
	})
	backup.Install(app, eng)

	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type":    "note",
		"content": "before",
	})

	sum, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	testutil.NewRecord(t, app, "fragment", map[string]any{
		"type":    "note",
		"content": "after",
	})

	if err := eng.Apply(context.Background(), sum.ID); err != nil {
		t.Fatal(err)
	}

	if drains != 1 {
		t.Fatalf("got %d drains, want 1", drains)
	}
	if restarts != 1 {
		t.Fatalf("got %d restarts, want 1", restarts)
	}

	outcome, err := eng.LastRestore()
	if err != nil {
		t.Fatal(err)
	}
	if outcome == nil || !outcome.OK || outcome.ID != sum.ID {
		t.Fatalf("unexpected outcome: %+v", outcome)
	}

	// Pre-restore snapshot should have been created by Apply
	sums, err := eng.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	foundPreRestore := false
	for _, s := range sums {
		if s.Kind == backup.KindPreRestore {
			foundPreRestore = true
			break
		}
	}
	if !foundPreRestore {
		t.Fatal("pre-restore backup not found in list after Apply")
	}

	tempDir := filepath.Join(app.DataDir(), ".pb_temp_to_delete")
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		t.Fatal(err)
	}

	foundOldDir := false
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "old_") {
			oldDataDB := filepath.Join(tempDir, entry.Name(), "data.db")
			if _, err := os.Stat(oldDataDB); err == nil {
				foundOldDir = true
				break
			}
		}
	}
	if !foundOldDir {
		t.Fatal("old_* dir holding data.db not found in .pb_temp_to_delete")
	}

	manifestPath := filepath.Join(app.DataDir(), backup.ManifestName)
	if _, err := os.Stat(manifestPath); !os.IsNotExist(err) {
		t.Fatalf("expected manifest to not exist at %s", manifestPath)
	}
}

func TestApplyFailingExtractRestartsAndWritesOutcomeFalse(t *testing.T) {
	app := testutil.NewApp(t)
	backupsDir := filepath.Join(app.DataDir(), "backups")
	if err := os.MkdirAll(backupsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	restarts := 0
	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{
		Origin: "local",
		Lifecycle: backup.Lifecycle{
			Restart: func() error {
				restarts++
				return nil
			},
		},
	})
	backup.Install(app, eng)

	// Write an invalid zip that will fail extraction or missing data.db
	invalidZip := "manual-20261001T203003Z.zip"
	writeZip(t, filepath.Join(backupsDir, invalidZip), map[string][]byte{
		backup.ManifestName: mustMarshal(t, backup.Manifest{
			Version:       1,
			SchemaVersion: schema.Version,
			Kind:          backup.KindManual,
		}),
		"other.txt": []byte("no data.db"),
	})

	err := eng.Apply(context.Background(), invalidZip)
	if err == nil {
		t.Fatal("expected error from Apply with invalid archive, got nil")
	}

	if restarts != 1 {
		t.Fatalf("got %d restarts on failure, want 1", restarts)
	}

	outcome, err := eng.LastRestore()
	if err != nil {
		t.Fatal(err)
	}
	if outcome == nil {
		t.Fatal("expected outcome to be written, got nil")
	}
	if outcome.OK {
		t.Fatal("expected outcome.OK to be false, got true")
	}
	if outcome.ID != invalidZip {
		t.Fatalf("got outcome ID %q, want %q", outcome.ID, invalidZip)
	}
	if outcome.Error == "" {
		t.Fatal("expected non-empty outcome Error")
	}
}

func TestApplyDrainCalledBeforeBeforeSwap(t *testing.T) {
	app := testutil.NewApp(t)
	var order []string

	eng := backup.New(app, backup.NewLocalStore(app.DataDir), backup.Options{
		Origin: "local",
		Lifecycle: backup.Lifecycle{
			Drain: func() {
				order = append(order, "drain")
			},
			BeforeSwap: func() error {
				order = append(order, "beforeswap")
				return nil
			},
			Restart: func() error {
				order = append(order, "restart")
				return nil
			},
		},
	})
	backup.Install(app, eng)

	sum, err := eng.Create(context.Background(), backup.KindManual)
	if err != nil {
		t.Fatal(err)
	}

	if err := eng.Apply(context.Background(), sum.ID); err != nil {
		t.Fatal(err)
	}

	if len(order) != 3 || order[0] != "drain" || order[1] != "beforeswap" || order[2] != "restart" {
		t.Fatalf("unexpected execution order: %v, want [drain beforeswap restart]", order)
	}
}

func writeZip(t *testing.T, targetPath string, files map[string][]byte) {
	t.Helper()
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

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestS3StoreEmptyConfig(t *testing.T) {
	store := backup.NewS3Store(func() string { return t.TempDir() }, backup.S3Config{}, "backups/test")
	_, err := store.List(context.Background())
	if err == nil {
		t.Fatal("expected error from empty s3 config, got nil")
	}
}

func TestNormalizePrefix(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", "/"},
		{"backups", "backups/"},
		{"backups/", "backups/"},
		{"backups///", "backups/"},
		{"a/b/c", "a/b/c/"},
	}
	for _, tt := range tests {
		if got := backup.NormalizePrefix(tt.input); got != tt.expected {
			t.Errorf("NormalizePrefix(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}
