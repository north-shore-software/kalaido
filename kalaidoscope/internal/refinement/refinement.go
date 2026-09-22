// UNREVIEWED
package refinement

import (
	"errors"
	"log/slog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// ErrMessagesRequired indicates no messages were provided or generated for the prompt.
var ErrMessagesRequired = errors.New("messages required")

// ErrNoModel indicates no model was configured for refinement.
var ErrNoModel = errors.New("no model configured for refinement")

// ErrNotFound indicates the refinement conversation could not be located.
var ErrNotFound = errors.New("refinement conversation not found")

func logger(app core.App) *slog.Logger {
	if app == nil {
		return slog.Default()
	}
	return app.Logger().With("component", "refinement")
}

// Find locates a projection or reflection refinement record by its external conversation id.
func Find(app core.App, clientID string) (*core.Record, error) {
	if r, err := app.FindFirstRecordByFilter(schema.ColProjectionRefinement.String(), "external_conversation_id = {:id}", dbx.Params{"id": clientID}); err == nil {
		return r, nil
	}
	if r, err := app.FindFirstRecordByFilter(schema.ColReflectionRefinement.String(), "external_conversation_id = {:id}", dbx.Params{"id": clientID}); err == nil {
		return r, nil
	}
	return nil, ErrNotFound
}

// Parent resolves the parent projection or reflection entity record for the refinement.
func Parent(app core.App, refRec *core.Record) *core.Record {
	targetCol, snapshotField := "projection", "projection_snapshot_id"
	if refRec.Collection().Name == schema.ColReflectionRefinement.String() {
		targetCol, snapshotField = "reflection", "reflection_snapshot_id"
	}
	parentID := refRec.GetString(targetCol + "_id")
	if parentID == "" {
		if snapID := refRec.GetString(snapshotField); snapID != "" {
			if snap, err := app.FindRecordById(targetCol+"_snapshot", snapID); err == nil {
				parentID = snap.GetString(targetCol + "_id")
			}
		}
	}
	if parentID == "" {
		return nil
	}
	rec, err := app.FindRecordById(targetCol, parentID)
	if err != nil || engine.IsDeleted(rec) {
		return nil
	}
	return rec
}
