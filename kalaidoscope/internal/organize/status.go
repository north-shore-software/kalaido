package organize

import (
	"context"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/discover"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/mapping"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reconcile"
)

func Evaluate(ctx context.Context, app core.App, now time.Time) (api.OrganizeStatus, error) {
	var st api.OrganizeStatus

	fragments, err := app.CountRecords("fragment", dbx.NewExp("deleted_at = ''"))
	if err != nil {
		return st, err
	}
	st.Fragments = int(fragments)

	if err := evaluateImports(app, &st.Imports); err != nil {
		return st, err
	}

	doc, version, err := mapping.LoadDocument(app)
	if err != nil {
		return st, err
	}
	things := 0
	if doc != nil {
		things = len(doc.Things)
	}

	if err := evaluateMap(app, version, int(fragments), &st.Map); err != nil {
		return st, err
	}
	if err := evaluateDiscover(app, version, things, &st.Discover); err != nil {
		return st, err
	}

	st.Policy = api.OrganizePolicy{
		Wave: reconcile.WaveEnabled(),
	}
	return st, nil
}

func evaluateImports(app core.App, out *api.ImportsStatus) error {
	pending, err := app.CountRecords("ingest", dbx.HashExp{"status": "pending"})
	if err != nil {
		return err
	}
	out.Pending = int(pending)
	errored, err := app.FindRecordsByFilter("ingest", "status = 'error'", "-created", 1, 0)
	if err != nil {
		return err
	}
	if len(errored) > 0 {
		out.LastError = errored[0].GetString("error")
	}
	return nil
}

func evaluateMap(app core.App, version, fragments int, out *api.MapStatus) error {
	annotated, err := app.CountRecords("fragment_annotation")
	if err != nil {
		return err
	}
	unfolded, err := app.CountRecords("fragment_annotation", dbx.HashExp{"folded": false})
	if err != nil {
		return err
	}
	pending, err := mapping.PendingCount(app)
	if err != nil {
		return err
	}
	runs, err := app.FindRecordsByFilter("map_run", "1=1", "-created", 1, 0)
	if err != nil {
		return err
	}

	out.Version = version
	out.Annotated = int(annotated)
	out.Unfolded = int(unfolded)
	out.PendingAnnotation = pending
	out.LastDrainError = mapping.LastDrainError()

	consolidating := mapping.Consolidating()
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
	case pending > 0 && mapping.Annotating():
		out.State = api.MapStateAnnotating
	case pending > 0:
		out.State = api.MapStateUnannotated
	case unfolded > 0:
		out.State = api.MapStateFolding
	default:
		out.State = api.MapStateSettled
	}
	return nil
}

func evaluateDiscover(app core.App, version, things int, out *api.DiscoverStatus) error {
	out.Running = discover.Running()
	out.Pending = discover.Pending()
	out.Due = []string{}
	out.Runs = map[string]api.RunInfo{}

	anyRun := false
	for _, kind := range discover.KindOrder() {
		newest, err := app.FindRecordsByFilter("discover_run", "kind = {:kind}", "-created", 1, 0, dbx.Params{"kind": kind})
		if err != nil {
			return err
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
		done, err := app.FindRecordsByFilter("discover_run", "kind = {:kind} && status = 'done'", "-created", 1, 0, dbx.Params{"kind": kind})
		if err != nil {
			return err
		}
		if len(done) == 0 || done[0].GetInt("map_version") < version {
			out.Due = append(out.Due, kind)
		}
	}

	projections, err := app.CountRecords("projection", dbx.HashExp{"status": "proposed"})
	if err != nil {
		return err
	}
	reflections, err := app.CountRecords("reflection", dbx.HashExp{"status": "proposed"})
	if err != nil {
		return err
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
	return nil
}

func runInfo(rec *core.Record) api.RunInfo {
	return api.RunInfo{
		ID:         rec.Id,
		Status:     rec.GetString("status"),
		Error:      rec.GetString("error"),
		Model:      rec.GetString("model"),
		Rounds:     rec.GetInt("rounds"),
		MapVersion: rec.GetInt("map_version"),
		Finished:   rec.GetDateTime("updated").Time().UTC().Format(time.RFC3339),
	}
}
