package schema

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// The failed marker survives the process so the next boot knows the last
// upgrade attempt failed and the database was restored. It carries the build
// that failed: the same build refuses to try again (it would fail the same
// way, and each attempt churns a backup), a different build clears the marker
// and retries — so shipping a fix is the whole recovery procedure.
const failedMarkerName = "schema-migration-failed.json"

// Failure describes one failed upgrade attempt.
type Failure struct {
	From      int       `json:"from"`
	To        int       `json:"to"`
	Delta     string    `json:"delta"`
	Error     string    `json:"error"`
	Backup    string    `json:"backup"`
	Restored  bool      `json:"restored"`
	At        time.Time `json:"at"`
	BinaryRev string    `json:"binaryRev"`
}

// ErrMigrationFailed wraps every error the runner returns for a failed or
// previously failed upgrade, so callers can tell it from a boot error.
var ErrMigrationFailed = errors.New("schema migration failed")

func failedMarkerPath(dataDir string) string {
	return filepath.Join(dataDir, failedMarkerName)
}

func readFailure(dataDir string) (*Failure, error) {
	b, err := os.ReadFile(failedMarkerPath(dataDir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var f Failure
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("schema: unreadable failed marker %s: %w", failedMarkerPath(dataDir), err)
	}
	return &f, nil
}

func writeFailure(dataDir string, f *Failure) error {
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(failedMarkerPath(dataDir), b, 0o644)
}

func clearFailure(dataDir string) error {
	err := os.Remove(failedMarkerPath(dataDir))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// report prints the failure two ways. The plain stderr line is what the
// desktop app shows today: the Tauri sidecar puts the process's last log
// lines into its load-error message. The KALAIDO_MIGRATION_FAILED line on
// stdout is captured by the sidecar's KALAIDO_ filter (and readable in a
// container log) for a dedicated app stage to parse.
func report(f *Failure) {
	state := "Database restored to v" + fmt.Sprint(f.From)
	if !f.Restored {
		state = "Restore FAILED; the database may be inconsistent"
	}
	fmt.Fprintf(os.Stderr, "schema migration to v%d failed in %s: %s. %s (backup: %s). Update Kalaido to retry.\n",
		f.To, f.Delta, f.Error, state, f.Backup)
	if b, err := json.Marshal(f); err == nil {
		fmt.Printf("KALAIDO_MIGRATION_FAILED=%s\n", b)
	}
}
