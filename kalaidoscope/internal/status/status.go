package status

import (
	stdctx "context"
	"sort"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/engine"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/llmcontext"
)

type Evaluator struct {
	app core.App
	now time.Time
}

func NewEvaluator(app core.App, now time.Time) *Evaluator {
	return &Evaluator{app: app, now: now}
}
func (e *Evaluator) EvaluateAll(ctx stdctx.Context) ([]api.EntityStatus, error) {
	projections, err := e.app.FindRecordsByFilter("projection", "status = 'active'", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}
	reflections, err := e.app.FindRecordsByFilter("reflection", "status = 'active'", "", 0, 0, nil)
	if err != nil {
		return nil, err
	}

	nodes := make(map[string]*node)
	for _, rec := range projections {
		nodes[rec.Id] = e.buildNode(rec, "projection")
	}
	for _, rec := range reflections {
		nodes[rec.Id] = e.buildNode(rec, "reflection")
	}

	// Calculate edges
	for _, n := range nodes {
		for _, depID := range n.spec.SourceProjectionIDs {
			if dep, ok := nodes[depID]; ok {
				n.deps = append(n.deps, dep)
				dep.dependents = append(dep.dependents, n)
			}
		}
		for _, depID := range n.spec.SourceReflectionIDs {
			if dep, ok := nodes[depID]; ok {
				n.deps = append(n.deps, dep)
				dep.dependents = append(dep.dependents, n)
			}
		}
	}

	// Topological sort
	sorted, err := topoSort(nodes)
	if err != nil {
		return nil, err // Cycle detected
	}

	var results []api.EntityStatus
	for _, n := range sorted {
		status, err := e.evaluateNode(ctx, n, nodes)
		if err != nil {
			return nil, err
		}
		n.status = status
		results = append(results, status)
	}

	return results, nil
}

type node struct {
	record     *core.Record
	entityType string
	spec       api.ContextSpec
	deps       []*node
	dependents []*node
	status     api.EntityStatus
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

func topoSort(nodes map[string]*node) ([]*node, error) {
	var sorted []*node
	visited := make(map[string]bool)
	temp := make(map[string]bool)

	var visit func(n *node) error
	visit = func(n *node) error {
		if temp[n.record.Id] {
			return nil // Cycle detected, but let's ignore or return error? We should return error
		}
		if !visited[n.record.Id] {
			temp[n.record.Id] = true
			for _, dep := range n.deps {
				if err := visit(dep); err != nil {
					return err
				}
			}
			temp[n.record.Id] = false
			visited[n.record.Id] = true
			sorted = append(sorted, n)
		}
		return nil
	}

	for _, n := range nodes {
		if !visited[n.record.Id] {
			if err := visit(n); err != nil {
				return nil, err
			}
		}
	}
	return sorted, nil
}

func (e *Evaluator) evaluateNode(ctx stdctx.Context, n *node, allNodes map[string]*node) (api.EntityStatus, error) {
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

	if liveSnapID == "" {
		// Draft entity: ignore staleness according to plan.
		return status, nil
	}

	var recordedPinned llmcontext.PinnedIDs
	_ = snapRec.UnmarshalJSONField("resolved_context", &recordedPinned)

	// Resolve the spec to see what it *should* include right now
	currentPinned, err := llmcontext.ResolveSpecToIDs(ctx, e.app, n.spec)
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
		if sr, err := e.app.FindRecordById("projection_snapshot", sID); err == nil {
			staleDeps[sr.GetString("projection_id")] = true
		} else if sr, err := e.app.FindRecordById("reflection_snapshot", sID); err == nil {
			staleDeps[sr.GetString("reflection_id")] = true
		}
	}

	// Recursive check: a dependency that is not itself up to date blocks us.
	// Regenerating against it would consume output that is about to be
	// superseded, so this is reported separately from the diff above — the two
	// look alike here but mean opposite things to a caller deciding what to do
	// next. Topological order guarantees dep.status is already evaluated.
	blockedBy := make(map[string]bool)
	for _, dep := range n.deps {
		if dep.status.UpToDateSnapshotID == "" {
			// Check if dep has any snapshots. If it has no snapshots, it's a draft, and we ignore it.
			depSnapCol := "projection_snapshot"
			depFK := "projection_id"
			if dep.entityType == "reflection" {
				depSnapCol = "reflection_snapshot"
				depFK = "reflection_id"
			}
			c, _ := e.app.FindRecordsByFilter(depSnapCol, depFK+" = {:id} && status = 'approved'", "-approval_sequence_number", 1, 0, dbx.Params{"id": dep.record.Id})
			if len(c) > 0 {
				blockedBy[dep.record.Id] = true
			}
		}
	}

	// A dep can be both: it published something we haven't consumed *and* has
	// moved on again since. Blocked wins — there is nothing useful to do yet —
	// so it is reported once, as the stronger of the two.
	for depID := range staleDeps {
		if !blockedBy[depID] {
			status.StaleDependencies = append(status.StaleDependencies, depID)
		}
	}
	for depID := range blockedBy {
		status.BlockedBy = append(status.BlockedBy, depID)
	}
	// Map iteration is unordered; sort so the response is stable across calls.
	sort.Strings(status.StaleDependencies)
	sort.Strings(status.BlockedBy)

	// Window evaluation for scheduled entities. The resume point is the max
	// approved window end (engine.LastApprovedWindowEnd) — the live snapshot
	// found above is picked by approval sequence, which counts per window and
	// says nothing about which window was generated last.
	version, ok := engine.GoverningVersion(engine.LoadWindowSpecVersions(n.record), e.now)
	if ok && version.Spec.Period != "" {
		created := n.record.GetDateTime("created").Time()
		status.PendingWindows = engine.CalculatePendingWindows(
			n.record.Id, version.Spec, engine.LastApprovedWindowEnd(e.app, n.record.Id), created, e.now)
	}

	if len(status.NewFragmentIDs) == 0 && len(status.StaleDependencies) == 0 &&
		len(status.BlockedBy) == 0 && len(status.PendingWindows) == 0 {
		status.UpToDateSnapshotID = liveSnapID
	}

	return status, nil
}
