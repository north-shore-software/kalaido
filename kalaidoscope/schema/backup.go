// UNREVIEWED
package schema

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Backups go beside PocketBase's own (pb_data/backups) — a directory PB
// already excludes from its zip backups — under a name PB's listing ignores.
const (
	backupsDir    = "backups"
	backupPrefix  = "pre-migration-v"
	backupsToKeep = 3
)

// createBackup snapshots data.db with VACUUM INTO, which SQLite guarantees is
// a consistent copy including everything still in the WAL, with the database
// open and other connections live. A plain file copy would be neither.
func createBackup(app core.App, fromVersion int) (string, error) {
	dir := filepath.Join(app.DataDir(), backupsDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("schema: backups dir: %w", err)
	}
	path := filepath.Join(dir, fmt.Sprintf("%s%d-%d.db", backupPrefix, fromVersion, time.Now().Unix()))
	_ = os.Remove(path) // VACUUM INTO refuses an existing file
	// Paths are not bindable in VACUUM INTO; quote by hand.
	quoted := strings.ReplaceAll(path, "'", "''")
	if _, err := app.DB().NewQuery("VACUUM INTO '" + quoted + "'").Execute(); err != nil {
		return "", fmt.Errorf("schema: backup to %s: %w", path, err)
	}
	pruneBackups(dir, backupsToKeep)
	return path, nil
}

// pruneBackups keeps the newest `keep` pre-migration backups by name (the
// name carries the unix time, so lexical order within a version is time
// order; across versions the version number leads).
func pruneBackups(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), backupPrefix) && strings.HasSuffix(e.Name(), ".db") {
			names = append(names, e.Name())
		}
	}
	if len(names) <= keep {
		return
	}
	infos := make([]os.FileInfo, 0, len(names))
	for _, n := range names {
		if fi, err := os.Stat(filepath.Join(dir, n)); err == nil {
			infos = append(infos, fi)
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ModTime().After(infos[j].ModTime()) })
	for _, fi := range infos[keep:] {
		_ = os.Remove(filepath.Join(dir, fi.Name()))
	}
}

// restoreBackup puts the backup in place of data.db. Every connection must be
// closed first (the runner calls ResetBootstrapState and the flavour's
// BeforeRestore before this): the WAL and shm files belong to the database
// being discarded and are removed with it.
func restoreBackup(dataDir, backup string) error {
	target := filepath.Join(dataDir, "data.db")
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Remove(target + suffix); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("schema: remove %s: %w", target+suffix, err)
		}
	}
	tmp := target + ".restoring"
	if err := copyFile(backup, tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		return fmt.Errorf("schema: replace data.db: %w", err)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("schema: open backup: %w", err)
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("schema: create %s: %w", dst, err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return fmt.Errorf("schema: copy backup: %w", err)
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
