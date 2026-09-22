package mapping

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// EvaluateStatus derives the workspace map status from database rows and the live worker.
func EvaluateStatus(app core.App, maps *Worker, version, fragments int) (api.MapStatus, error) {
	var out api.MapStatus

	annotated, err := app.CountRecords(schema.ColFragmentAnnotation.String())
	if err != nil {
		return out, err
	}
	unconsolidated, err := app.CountRecords(schema.ColFragmentAnnotation.String(), dbx.HashExp{"consolidated_at": ""})
	if err != nil {
		return out, err
	}
	pending, err := PendingCount(app)
	if err != nil {
		return out, err
	}
	runs, err := app.FindRecordsByFilter(schema.ColMapRun.String(), "1=1", "-created", 1, 0)
	if err != nil {
		return out, err
	}

	out.Version = version
	out.Annotated = int(annotated)
	out.Unconsolidated = int(unconsolidated)
	out.PendingAnnotation = pending
	out.LastDrainError = maps.LastDrainError()
	if maps != nil {
		out.WantSettle = maps.WantSettle()
	}

	consolidating := maps.Consolidating()
	if len(runs) > 0 {
		info := runInfo(runs[0])
		info.Interrupted = info.Status == "running" && !consolidating
		out.LastRun = &info
	}

	switch {
	case fragments == 0:
		out.State = api.MapStateEmpty
	case consolidating:
		out.State = api.MapStateConsolidating
	case pending > 0 && maps.Annotating():
		out.State = api.MapStateAnnotating
	case pending > 0:
		out.State = api.MapStateUnannotated
	case unconsolidated > 0:
		out.State = api.MapStateFolding
	default:
		out.State = api.MapStateSettled
	}
	return out, nil
}

func runInfo(rec *core.Record) api.RunInfo {
	return api.RunInfo{
		ID:       rec.Id,
		Status:   rec.GetString("status"),
		Error:    rec.GetString("error"),
		Model:    rec.GetString("generated_by_model"),
		Finished: rec.GetDateTime("updated").Time().UTC().Format(time.RFC3339),
	}
}
