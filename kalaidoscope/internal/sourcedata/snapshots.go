package sourcedata

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// FindProjectionSnapshotByID loads one projection snapshot.
func FindProjectionSnapshotByID(app core.App, id string) (*core.Record, error) {
	return app.FindRecordById(schema.ColProjectionSnapshot.String(), id)
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
