package schema

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The version table is plain SQL, not a collection: it is not part of the
// product schema, must not appear in the API or the generated types, and has
// to be readable before any collection is trusted. One row per version ever
// applied to this database; the current version is the highest.
const stateTable = "_kalaido_schema"

const (
	sourceBootstrap = "bootstrap"
	sourceDelta     = "delta"
)

// HistoryRow is one applied version.
type HistoryRow struct {
	Version   int    `db:"version" json:"version"`
	AppliedAt string `db:"applied_at" json:"appliedAt"`
	Source    string `db:"source" json:"source"`
	BinaryRev string `db:"binary_rev" json:"binaryRev"`
}

func stateTableExists(app core.App) (bool, error) {
	var name string
	err := app.DB().NewQuery(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = {:name}",
	).Bind(map[string]any{"name": stateTable}).Row(&name)
	if err != nil {
		if err.Error() == "sql: no rows in result set" {
			return false, nil
		}
		return false, err
	}
	return name == stateTable, nil
}

func ensureStateTable(app core.App) error {
	_, err := app.NonconcurrentDB().NewQuery(`
		CREATE TABLE IF NOT EXISTS ` + stateTable + ` (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			version INTEGER NOT NULL,
			applied_at TEXT NOT NULL,
			source TEXT NOT NULL,
			binary_rev TEXT NOT NULL
		)`).Execute()
	return err
}

// currentVersion is the highest version stamped; 0 when the table is empty.
func currentVersion(app core.App) (int, error) {
	var v int
	err := app.DB().NewQuery("SELECT COALESCE(MAX(version), 0) FROM " + stateTable).Row(&v)
	if err != nil {
		return 0, fmt.Errorf("schema: read version: %w", err)
	}
	return v, nil
}

func stamp(app core.App, version int, source string) error {
	_, err := app.NonconcurrentDB().NewQuery(
		"INSERT INTO " + stateTable + " (version, applied_at, source, binary_rev) VALUES ({:v}, {:at}, {:src}, {:rev})",
	).Bind(map[string]any{
		"v":   version,
		"at":  types.NowDateTime().String(),
		"src": source,
		"rev": buildRev(),
	}).Execute()
	if err != nil {
		return fmt.Errorf("schema: stamp version %d: %w", version, err)
	}
	return nil
}

func history(app core.App) ([]HistoryRow, error) {
	var rows []HistoryRow
	err := app.DB().NewQuery(
		"SELECT version, applied_at, source, binary_rev FROM " + stateTable + " ORDER BY id",
	).All(&rows)
	return rows, err
}
