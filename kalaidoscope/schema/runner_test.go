// UNREVIEWED
package schema

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// stage isolates the package registries for one test and restores them.
func stage(t *testing.T, target int, ds ...Delta) {
	t.Helper()
	prevDeltas, prevExt, prevLatest, prevRev := deltas, extensions, latestVersion, BuildRev
	t.Cleanup(func() { deltas, extensions, latestVersion, BuildRev = prevDeltas, prevExt, prevLatest, prevRev })
	deltas = nil
	for _, d := range ds {
		RegisterDelta(d)
	}
	latestVersion = target
}

func open(t *testing.T, dir string) (*pocketbase.PocketBase, error) {
	t.Helper()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	Install(app, Options{})
	err := app.Bootstrap()
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	return app, err
}

func mustOpen(t *testing.T, dir string) *pocketbase.PocketBase {
	t.Helper()
	app, err := open(t, dir)
	if err != nil {
		t.Fatalf("open %s: %v", dir, err)
	}
	return app
}

func version(t *testing.T, app core.App) int {
	t.Helper()
	st, err := CurrentStatus(app)
	if err != nil {
		t.Fatal(err)
	}
	return st.Version
}

func addField(collection, field string) func(core.App) error {
	return func(app core.App) error {
		return Modify(app, collection, func(c *core.Collection) error {
			c.Fields.Add(&core.TextField{Name: field})
			return nil
		})
	}
}

func hasField(app core.App, collection, field string) bool {
	c, err := app.FindCollectionByNameOrId(collection)
	return err == nil && c.Fields.GetByName(field) != nil
}

func TestFreshBootstrapCreatesCanonicalAtVersion(t *testing.T) {
	dir := t.TempDir()
	app := mustOpen(t, dir)
	if got := version(t, app); got != Version {
		t.Fatalf("version %d, want %d", got, Version)
	}
	if _, err := app.FindCollectionByNameOrId("fragment"); err != nil {
		t.Fatalf("fragment collection missing: %v", err)
	}
	st, _ := CurrentStatus(app)
	if len(st.History) != 1 || st.History[0].Source != sourceBootstrap {
		t.Fatalf("history %+v, want one bootstrap row", st.History)
	}
	// Reopening at the same version is a no-op: no backup, no new history.
	_ = app.ResetBootstrapState()
	again := mustOpen(t, dir)
	st, _ = CurrentStatus(again)
	if len(st.History) != 1 {
		t.Fatalf("history after reopen %+v, want unchanged", st.History)
	}
	if _, err := os.Stat(filepath.Join(dir, backupsDir)); !os.IsNotExist(err) {
		t.Fatalf("backups dir exists after a no-op boot")
	}
}

func TestUpgradeAppliesDeltasInOrderWithBackup(t *testing.T) {
	dir := t.TempDir()
	stage(t, 1)
	_ = mustOpen(t, dir).ResetBootstrapState()

	var order []string
	note := func(name string, up func(core.App) error) func(core.App) error {
		return func(app core.App) error { order = append(order, name); return up(app) }
	}
	stage(t, 3,
		Delta{Version: 3, Scope: ScopeCore, Name: "three_core", Up: note("three_core", addField("fragment", "zz_three"))},
		Delta{Version: 2, Scope: ScopeCloud, Name: "two_cloud", Up: note("two_cloud", addField("fragment", "zz_two_cloud"))},
		Delta{Version: 2, Scope: ScopeCore, Name: "two_core", Up: note("two_core", addField("fragment", "zz_two"))},
	)
	app := mustOpen(t, dir)

	if got := strings.Join(order, ","); got != "two_core,two_cloud,three_core" {
		t.Fatalf("delta order %s", got)
	}
	if got := version(t, app); got != 3 {
		t.Fatalf("version %d, want 3", got)
	}
	for _, f := range []string{"zz_two", "zz_two_cloud", "zz_three"} {
		if !hasField(app, "fragment", f) {
			t.Errorf("field %s missing after upgrade", f)
		}
	}
	st, _ := CurrentStatus(app)
	if len(st.History) != 3 || st.History[1].Source != sourceDelta || st.History[2].Version != 3 {
		t.Fatalf("history %+v", st.History)
	}
	backups, _ := filepath.Glob(filepath.Join(dir, backupsDir, backupPrefix+"1-*.db"))
	if len(backups) != 1 {
		t.Fatalf("pre-migration backups %v, want exactly one for v1", backups)
	}
}

func TestFailedUpgradeRestoresBackupAndBlocksSameBuild(t *testing.T) {
	dir := t.TempDir()
	stage(t, 1)
	_ = mustOpen(t, dir).ResetBootstrapState()

	// A delta that gets halfway: one save lands, then it fails.
	broken := Delta{Version: 2, Scope: ScopeCore, Name: "broken", Up: func(app core.App) error {
		if err := addField("fragment", "zz_partial")(app); err != nil {
			return err
		}
		return errors.New("boom")
	}}
	stage(t, 2, broken)
	BuildRev = "build-a"

	_, err := open(t, dir)
	if !errors.Is(err, ErrMigrationFailed) {
		t.Fatalf("open: %v, want ErrMigrationFailed", err)
	}
	f, err := readFailure(dir)
	if err != nil || f == nil {
		t.Fatalf("failed marker: %v %v", f, err)
	}
	if !f.Restored || f.From != 1 || f.To != 2 || f.Delta != "broken" || f.BinaryRev != "build-a" || !strings.Contains(f.Error, "boom") {
		t.Fatalf("marker %+v", f)
	}

	// The database is back to v1 with nothing from the delta in it.
	plain := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	if err := plain.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if hasField(plain, "fragment", "zz_partial") {
		t.Fatal("partial delta survived the restore")
	}
	if got := version(t, plain); got != 1 {
		t.Fatalf("version after restore %d, want 1", got)
	}
	_ = plain.ResetBootstrapState()

	// Same build: refuses without touching the database.
	backupsBefore, _ := filepath.Glob(filepath.Join(dir, backupsDir, "*.db"))
	_, err = open(t, dir)
	if !errors.Is(err, ErrMigrationFailed) || !strings.Contains(err.Error(), "not retrying") {
		t.Fatalf("same build reopen: %v", err)
	}
	backupsAfter, _ := filepath.Glob(filepath.Join(dir, backupsDir, "*.db"))
	if len(backupsAfter) != len(backupsBefore) {
		t.Fatalf("same build took another backup: %v", backupsAfter)
	}

	// A new build with the delta fixed: marker cleared, upgrade succeeds.
	stage(t, 2, Delta{Version: 2, Scope: ScopeCore, Name: "fixed", Up: addField("fragment", "zz_fixed")})
	BuildRev = "build-b"
	app := mustOpen(t, dir)
	if got := version(t, app); got != 2 {
		t.Fatalf("version after fix %d, want 2", got)
	}
	if !hasField(app, "fragment", "zz_fixed") {
		t.Fatal("fixed delta not applied")
	}
	if f, _ := readFailure(dir); f != nil {
		t.Fatalf("marker not cleared: %+v", f)
	}
}

func TestRetryModeClearsMarker(t *testing.T) {
	dir := t.TempDir()
	stage(t, 1)
	_ = mustOpen(t, dir).ResetBootstrapState()
	if err := writeFailure(dir, &Failure{From: 1, To: 2, BinaryRev: "build-a", At: time.Now()}); err != nil {
		t.Fatal(err)
	}
	stage(t, 2, Delta{Version: 2, Scope: ScopeCore, Name: "ok", Up: addField("fragment", "zz_ok")})
	BuildRev = "build-a"

	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return run(e.App, Options{}, modeRetry)
	})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if got := version(t, app); got != 2 {
		t.Fatalf("version %d, want 2", got)
	}
}

func TestInspectModeNeverChangesTheDatabase(t *testing.T) {
	dir := t.TempDir()
	stage(t, 1)
	_ = mustOpen(t, dir).ResetBootstrapState()
	stage(t, 2, Delta{Version: 2, Scope: ScopeCore, Name: "ok", Up: addField("fragment", "zz_ok")})

	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return run(e.App, Options{}, modeInspect)
	})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if lastStatus.Version != 1 || lastStatus.Latest != 2 {
		t.Fatalf("status %+v, want v1 of latest 2", lastStatus)
	}
	if got := version(t, app); got != 1 {
		t.Fatalf("inspect upgraded the database to v%d", got)
	}
}

func TestNewerDatabaseIsRefused(t *testing.T) {
	dir := t.TempDir()
	stage(t, 2, Delta{Version: 2, Scope: ScopeCore, Name: "ok", Up: addField("fragment", "zz_ok")})
	_ = mustOpen(t, dir).ResetBootstrapState()

	stage(t, 1)
	_, err := open(t, dir)
	if err == nil || !strings.Contains(err.Error(), "supports up to v1") {
		t.Fatalf("older build opened a newer database: %v", err)
	}
}

func TestUnversionedDatabaseIsRefused(t *testing.T) {
	dir := t.TempDir()
	plain := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	if err := plain.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := ApplyTables(plain, Canonical); err != nil {
		t.Fatal(err)
	}
	_ = plain.ResetBootstrapState()

	_, err := open(t, dir)
	if err == nil || !strings.Contains(err.Error(), "predates schema versioning") {
		t.Fatalf("pre-launch database opened: %v", err)
	}
}

func TestPruneBackupsKeepsNewest(t *testing.T) {
	dir := t.TempDir()
	base := time.Now().Add(-time.Hour)
	for i := 0; i < 5; i++ {
		p := filepath.Join(dir, backupPrefix+"1-"+string(rune('a'+i))+".db")
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		mt := base.Add(time.Duration(i) * time.Minute)
		if err := os.Chtimes(p, mt, mt); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "unrelated.db"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	pruneBackups(dir, 3)
	left, _ := filepath.Glob(filepath.Join(dir, backupPrefix+"*.db"))
	if len(left) != 3 {
		t.Fatalf("kept %v, want 3", left)
	}
	for _, name := range []string{"1-c.db", "1-d.db", "1-e.db"} {
		if _, err := os.Stat(filepath.Join(dir, backupPrefix+name)); err != nil {
			t.Errorf("newest backup %s was pruned", name)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "unrelated.db")); err != nil {
		t.Error("prune touched a file that is not a pre-migration backup")
	}
}

func TestModeFromArgs(t *testing.T) {
	cases := map[string]mode{
		"pb serve --dir x":          modeNormal,
		"pb schema bootstrap --dir": modeNormal,
		"pb schema status --dir x":  modeInspect,
		"pb schema retry --dir x":   modeRetry,
		"pb":                        modeNormal,
	}
	for args, want := range cases {
		if got := modeFromArgs(strings.Fields(args)); got != want {
			t.Errorf("%q: mode %d, want %d", args, got, want)
		}
	}
}
