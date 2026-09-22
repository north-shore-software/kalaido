// UNREVIEWED
package discover

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

// EvaluateStatus derives the discover pipeline status from database rows and the live worker.
func EvaluateStatus(app core.App, disc *Worker, version, things int) (api.DiscoverStatus, error) {
	var out api.DiscoverStatus

	out.Running = disc.Running()
	out.Pending = disc.Pending()
	out.Due = []string{}
	out.Runs = map[string]api.RunInfo{}

	anyRun := false
	for _, kind := range KindOrder() {
		newest, err := app.FindRecordsByFilter(schema.ColDiscoverRun.String(), "kind = {:kind}", "-created", 1, 0, dbx.Params{"kind": kind})
		if err != nil {
			return out, err
		}
		if len(newest) > 0 {
			anyRun = true
			info := runInfo(newest[0])
			info.Interrupted = info.Status == "running" && out.Running != kind
			out.Runs[kind] = info
		}
		if things == 0 {
			continue
		}
		done, err := app.FindRecordsByFilter(schema.ColDiscoverRun.String(), "kind = {:kind} && status = 'done'", "-created", 1, 0, dbx.Params{"kind": kind})
		if err != nil {
			return out, err
		}
		if len(done) == 0 || done[0].GetInt("map_version") < version {
			out.Due = append(out.Due, kind)
		}
	}

	projections, err := app.CountRecords(schema.ColProjection.String(), dbx.HashExp{"status": "proposed", "deleted_at": ""})
	if err != nil {
		return out, err
	}
	reflections, err := app.CountRecords(schema.ColReflection.String(), dbx.HashExp{"status": "proposed", "deleted_at": ""})
	if err != nil {
		return out, err
	}
	out.Proposals = api.ProposalCounts{Projections: int(projections), Reflections: int(reflections)}

	switch {
	case out.Running != "":
		out.State = api.DiscoverStateRunning
	case len(out.Pending) > 0:
		out.State = api.DiscoverStatePending
	case !anyRun:
		out.State = api.DiscoverStateNeverRun
	case len(out.Due) > 0:
		out.State = api.DiscoverStateDue
	default:
		out.State = api.DiscoverStateSettled
	}
	return out, nil
}

func runInfo(rec *core.Record) api.RunInfo {
	return api.RunInfo{
		ID:         rec.Id,
		Status:     rec.GetString("status"),
		Error:      rec.GetString("error"),
		Model:      rec.GetString("generated_by_model"),
		Rounds:     rec.GetInt("rounds"),
		MapVersion: rec.GetInt("map_version"),
		Finished:   rec.GetDateTime("updated").Time().UTC().Format(time.RFC3339),
	}
}
