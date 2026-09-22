// UNREVIEWED
package engine

import (
	"errors"
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// LiveFilter is the clause every reader of live projections/reflections
// appends: a soft-deleted entity (deleted_at set) is invisible to lists,
// staleness, discover and context resolution until restored.
const LiveFilter = "deleted_at = ''"

// ErrEntityDeleted: the projection/reflection exists but is soft-deleted.
// Routes report it as not found; only restore may touch the row.
var ErrEntityDeleted = errors.New("entity deleted")

// IsDeleted reports whether an entity row carries the soft-delete stamp.
func IsDeleted(rec *core.Record) bool {
	return !rec.GetDateTime("deleted_at").IsZero()
}

// FindLive loads a projection/reflection that is not soft-deleted. A missing
// row returns the store's not-found error; a deleted one ErrEntityDeleted.
func FindLive(app core.App, strat Strategy, id string) (*core.Record, error) {
	rec, err := app.FindRecordById(strat.CollectionName(), id)
	if err != nil {
		return nil, err
	}
	if IsDeleted(rec) {
		return nil, fmt.Errorf("%s %s: %w", strat.TargetType(), id, ErrEntityDeleted)
	}
	return rec, nil
}

// HasLiveClaim reports whether a generation is running for the entity right
// now: a status='generating' claim row (any window) younger than the claim
// TTL. Older claims belong to a crashed run and do not count.
func HasLiveClaim(app core.App, strat Strategy, parentID string) (bool, error) {
	recs, err := app.FindRecordsByFilter(strat.SnapshotCollectionName(),
		strat.ForeignKeyCol()+" = {:parent} && status = {:status}", "", 0, 0,
		map[string]any{"parent": parentID, "status": StatusGenerating})
	if err != nil {
		return false, err
	}
	for _, c := range recs {
		if time.Since(c.GetDateTime("created").Time()) < GenerationClaimTTL {
			return true, nil
		}
	}
	return false, nil
}

// SoftDelete stamps the entity; a second call is a no-op.
func SoftDelete(app core.App, rec *core.Record) error {
	if IsDeleted(rec) {
		return nil
	}
	rec.Set("deleted_at", types.NowDateTime())
	return app.Save(rec)
}

// Restore clears the stamp; a live entity is left as is.
func Restore(app core.App, rec *core.Record) error {
	if !IsDeleted(rec) {
		return nil
	}
	rec.Set("deleted_at", "")
	return app.Save(rec)
}
