// UNREVIEWED
package refinement

import (
	"errors"
	"log/slog"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

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
	switch refRec.Collection().Name {
	case schema.ColProjectionRefinement.String():
		pid := refRec.GetString("projection_id")
		if pid != "" {
			if r, err := app.FindRecordById(schema.ColProjection.String(), pid); err == nil {
				return r
			}
		}
	case schema.ColReflectionRefinement.String():
		rid := refRec.GetString("reflection_id")
		if rid != "" {
			if r, err := app.FindRecordById(schema.ColReflection.String(), rid); err == nil {
				return r
			}
		}
	}
	return nil
}
