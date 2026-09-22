// UNREVIEWED
package pbutil

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// IsDeleted reports whether a record carries the soft-delete stamp (deleted_at set).
func IsDeleted(rec *core.Record) bool {
	return !rec.GetDateTime("deleted_at").IsZero()
}

// SoftDelete stamps the record with deleted_at; a second call is a no-op.
func SoftDelete(app core.App, rec *core.Record) error {
	if IsDeleted(rec) {
		return nil
	}
	rec.Set("deleted_at", types.NowDateTime())
	return app.Save(rec)
}

// Restore clears the soft-delete stamp; an already live record is left as is.
func Restore(app core.App, rec *core.Record) error {
	if !IsDeleted(rec) {
		return nil
	}
	rec.Set("deleted_at", "")
	return app.Save(rec)
}
