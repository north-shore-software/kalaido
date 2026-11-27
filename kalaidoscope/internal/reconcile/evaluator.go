package reconcile

import (
	stdctx "context"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/projections"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/reflections"
	"github.com/north-shore-software/kalaido/kalaidoscope/schema"
)

type Evaluator struct {
	app core.App
	now time.Time
}

func NewEvaluator(app core.App, now time.Time) *Evaluator {
	return &Evaluator{app: app, now: now}
}

func (e *Evaluator) EvaluateAll(ctx stdctx.Context) ([]api.EntityStatus, error) {
	projections, err := e.app.FindRecordsByFilter(schema.ColProjection.String(), "status = 'active' && "+engine.LiveFilter, "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	reflections, err := e.app.FindRecordsByFilter(schema.ColReflection.String(), "status = 'active' && "+engine.LiveFilter, "", 0, 0, nil)
	if err != nil {
		return nil, err
	}

	results := make([]api.EntityStatus, 0, len(projections)+len(reflections))
	for _, rec := range projections {
		status, err := e.evaluateNode(ctx, e.buildNode(rec, "projection"))
		if err != nil {
			return nil, err
		}
		results = append(results, status)
	}
	for _, rec := range reflections {
		status, err := e.evaluateNode(ctx, e.buildNode(rec, "reflection"))
		if err != nil {
			return nil, err
		}
		results = append(results, status)
	}

	return results, nil
}

type node struct {
	record     *core.Record
	entityType string
	spec       api.ContextSpec
}

func (e *Evaluator) buildNode(rec *core.Record, entityType string) *node {
	spec := api.ContextSpec{}
	_ = rec.UnmarshalJSONField("current_context_spec", &spec)

	return &node{
		record:     rec,
		entityType: entityType,
		spec:       spec,
	}
}

// candidateContextSpec returns the pending candidate's own context_spec when
// populated, falling back to the projection's current_context_spec. Evaluating
// a candidate against its own spec ensures an uncommitted context change in
// refinement does not falsely flag the candidate as outdated.
func candidateContextSpec(candRec *core.Record, fallback api.ContextSpec) api.ContextSpec {
	raw := strings.TrimSpace(candRec.GetString("context_spec"))
	if raw == "" || raw == "null" {
		return fallback
	}
	var spec api.ContextSpec
	if err := candRec.UnmarshalJSONField("context_spec", &spec); err != nil {
		return fallback
	}
	return spec
}

// evaluateReflectionWindows is the windowed reflection's evaluation: each
// window with an approved snapshot is diffed on its own — the spec resolved
// inside that window against what that window's snapshot consumed — so a
// backdated fragment flags exactly the windows it falls in
// (spec/model.md §Handling Backdated Fragments), and fragments outside every
// window flag nothing. Windows the series owes but has never generated are
// pending. Returns done=false for a reflection with no windowed snapshot, which
// the caller evaluates the windowless way.
func (e *Evaluator) evaluateReflectionWindows(ctx stdctx.Context, n *node, status api.EntityStatus) (bool, api.EntityStatus) {
	series := reflections.SeriesWindows(e.app, n.record, e.now)
	windowed := false
	for _, st := range series {
		if st.HasApproved {
			windowed = true
			break
		}
	}
	if !windowed {
		return false, status
	}

	seen := make(map[string]bool)
	var newestEnd string
	var newestSnapID string
	for _, st := range series {
		if !st.HasApproved {
			if !st.Generating {
				status.PendingWindows = append(status.PendingWindows, st.Window)
			}
			continue
		}
		filter, params := engine.ApprovedSnapshotFilter(reflections.Strategy{}, n.record.Id, &st.Window)
		snaps, err := e.app.FindRecordsByFilter(schema.ColReflectionSnapshot.String(), filter,
			"-approval_sequence_number", 1, 0, params)
		if err != nil || len(snaps) == 0 {
			continue
		}
		snap := snaps[0]
		if st.End > newestEnd {
			newestEnd, newestSnapID = st.End, snap.Id
		}

		var recorded llmcontext.PinnedIDs
		_ = snap.UnmarshalJSONField("resolved_context", &recorded)
		w := st.Window
		current, err := llmcontext.ResolveSpecToIDs(ctx, e.app, n.spec, &w)
		if err != nil {
			continue
		}
		diff := current.Diff(recorded)
		if len(diff.FragmentIDs) == 0 {
			continue
		}
		// An empty-window placeholder whose window now contains matching
		// fragments becomes a pending window so automatic scheduled or manual
		// pending generation upgrades it with a real LLM snapshot. Non-empty
		// windows stay stale only and are never silently overwritten by cron.
		if snap.GetString("generated_by_model") == engine.SnapshotModelEmpty {
			if !st.Generating {
				status.PendingWindows = append(status.PendingWindows, st.Window)
			}
			continue
		}
		status.StaleWindows = append(status.StaleWindows, st.Window)
		for _, id := range diff.FragmentIDs {
			if !seen[id] {
				seen[id] = true
				status.NewFragmentIDs = append(status.NewFragmentIDs, id)
			}
		}
	}
	sort.Strings(status.NewFragmentIDs)

	if len(status.NewFragmentIDs) == 0 && len(status.StaleWindows) == 0 && len(status.PendingWindows) == 0 {
		status.UpToDateSnapshotID = newestSnapID
	}
	return true, status
}

func (e *Evaluator) evaluateNode(ctx stdctx.Context, n *node) (api.EntityStatus, error) {
	status := api.EntityStatus{
		ID:   n.record.Id,
		Type: n.entityType,
	}

	snapCollection := "projection_snapshot"
	foreignKey := "projection_id"
	if n.entityType == "reflection" {
		snapCollection = "reflection_snapshot"
		foreignKey = "reflection_id"
	}

	recs, err := e.app.FindRecordsByFilter(snapCollection,
		foreignKey+" = {:id} && status = 'approved'", "-approval_sequence_number", 1, 0,
		dbx.Params{"id": n.record.Id})

	var liveSnapID string
	var snapRec *core.Record
	if err == nil && len(recs) > 0 {
		snapRec = recs[0]
		liveSnapID = snapRec.Id
	}

	if n.entityType == "projection" {
		strat := projections.Strategy{}
		candRec, err := engine.FindPendingCandidate(e.app, strat, n.record.Id, nil)
		if err != nil {
			return status, err
		}
		if candRec != nil {
			engaged, err := engine.CandidateEngaged(e.app, strat, candRec)
			if err != nil {
				return status, err
			}
			if liveSnapID == "" {
				status.Candidate = &api.CandidateStatus{
					ID:      candRec.Id,
					Engaged: engaged,
				}
			} else {
				candSpec := candidateContextSpec(candRec, n.spec)
				candPinned, err := llmcontext.ResolveSpecToIDs(ctx, e.app, candSpec, nil)
				if err != nil {
					return status, err
				}
				var candRecorded llmcontext.PinnedIDs
				_ = candRec.UnmarshalJSONField("resolved_context", &candRecorded)
				newIDs := candPinned.Diff(candRecorded).FragmentIDs
				// Non-blocking: arriving fragments never freeze an open draft
				// session. Expose NewFragmentIDs only for optional passive notices.
				status.Candidate = &api.CandidateStatus{
					ID:             candRec.Id,
					Outdated:       false,
					Engaged:        engaged,
					NewFragmentIDs: newIDs,
				}
			}
		}
	}

	if liveSnapID == "" {
		// Draft entity: ignore staleness according to plan.
		return status, nil
	}

	if n.entityType == "reflection" {
		if done, windowed := e.evaluateReflectionWindows(ctx, n, status); done {
			return windowed, nil
		}
	}

	var recordedPinned llmcontext.PinnedIDs
	_ = snapRec.UnmarshalJSONField("resolved_context", &recordedPinned)

	currentPinned, err := llmcontext.ResolveSpecToIDs(ctx, e.app, n.spec, nil)
	if err != nil {
		return status, err
	}

	// Diff them: what's in current that's not in recorded?
	diff := currentPinned.Diff(recordedPinned)
	status.NewFragmentIDs = diff.FragmentIDs

	// If there are new snapshot IDs, it means an upstream dependency got a new snapshot.
	// We map the new snapshot IDs back to their projection/reflection IDs. These
	// are upstreams whose output has moved on — regenerating now consumes it.
	staleDeps := make(map[string]bool)
	for _, sID := range diff.SnapshotIDs {
		// Try projection snapshot
		if sr, err := e.app.FindRecordById(schema.ColProjectionSnapshot.String(), sID); err == nil {
			staleDeps[sr.GetString("projection_id")] = true
		} else if sr, err := e.app.FindRecordById(schema.ColReflectionSnapshot.String(), sID); err == nil {
			staleDeps[sr.GetString("reflection_id")] = true
		}
	}

	for depID := range staleDeps {
		status.StaleDependencies = append(status.StaleDependencies, depID)
	}
	// Map iteration is unordered; sort so the response is stable across calls.
	sort.Strings(status.StaleDependencies)

	// A reflection that reaches here has only windowless snapshots (an
	// unscheduled one, or one scheduled after the fact): it may still owe
	// grid windows.
	if n.entityType == "reflection" {
		status.PendingWindows = reflections.PendingWindows(e.app, n.record, e.now)
	}

	if len(status.NewFragmentIDs) == 0 && len(status.StaleDependencies) == 0 && len(status.PendingWindows) == 0 {
		status.UpToDateSnapshotID = liveSnapID
	}

	return status, nil
}

// EvaluateEntity evaluates the reconcile status for a single live active
// projection or reflection by ID.
func EvaluateEntity(ctx stdctx.Context, app core.App, id string) (api.EntityStatus, error) {
	e := NewEvaluator(app, time.Now())
	filter := "id = {:id} && status = 'active' && " + engine.LiveFilter
	params := dbx.Params{"id": id}

	for _, target := range []struct {
		col        string
		entityType string
	}{
		{schema.ColProjection.String(), "projection"},
		{schema.ColReflection.String(), "reflection"},
	} {
		recs, err := app.FindRecordsByFilter(target.col, filter, "", 1, 0, params)
		if err != nil {
			return api.EntityStatus{}, err
		}
		if len(recs) > 0 {
			return e.evaluateNode(ctx, e.buildNode(recs[0], target.entityType))
		}
	}
	return api.EntityStatus{}, nil
}
