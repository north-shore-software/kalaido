package sourcedata

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// FindSnapshotByID loads a single snapshot record by collection and ID.
func FindSnapshotByID(app core.App, collection string, id string) (*core.Record, error) {
	return app.FindRecordById(collection, id)
}

// FindProjectionSnapshotsByIDs loads projection snapshots for the given IDs.
func FindProjectionSnapshotsByIDs(app core.App, ids []string) ([]*core.Record, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return app.FindRecordsByIds(schema.ColProjectionSnapshot.String(), ids)
}

// FindReflectionSnapshotsByIDs loads reflection snapshots for the given IDs.
func FindReflectionSnapshotsByIDs(app core.App, ids []string) ([]*core.Record, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return app.FindRecordsByIds(schema.ColReflectionSnapshot.String(), ids)
}

// LatestApprovedSnapshot returns the newest approved snapshot for an entity (projection or reflection),
// ordered by approval_sequence_number descending. Returns nil, nil if none exist.
func LatestApprovedSnapshot(app core.App, collection string, parentForeignKey string, parentID string) (*core.Record, error) {
	filter := parentForeignKey + " = {:id} && status = 'approved'"
	recs, err := app.FindRecordsByFilter(collection, filter, "-approval_sequence_number", 1, 0, dbx.Params{"id": parentID})
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, nil
	}
	return recs[0], nil
}
