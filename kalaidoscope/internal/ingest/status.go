package ingest

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// EvaluateStatus derives the import queue status from ingest records.
func EvaluateStatus(app core.App) (api.ImportsStatus, error) {
	var out api.ImportsStatus

	pending, err := app.CountRecords(schema.ColIngest.String(), dbx.HashExp{"status": "pending"})
	if err != nil {
		return out, err
	}
	out.Pending = int(pending)
	errored, err := app.FindRecordsByFilter(schema.ColIngest.String(), "status = 'error'", "-created", 1, 0)
	if err != nil {
		return out, err
	}
	if len(errored) > 0 {
		out.LastError = errored[0].GetString("error")
	}
	return out, nil
}
