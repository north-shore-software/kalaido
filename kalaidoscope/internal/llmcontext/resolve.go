package llmcontext

import (
	stdctx "context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/prompts"
)

// ResolveSpecToIDs evaluates a spec into the concrete set of fragments and
// upstream snapshots it names right now. A non-nil window restricts the
// fragments to those whose event date falls inside it (spec/model.md
// §Boundary Semantics: half-open, [start, end)); upstream snapshots are not
// windowed — a reflection cannot consume them anyway.
func ResolveSpecToIDs(ctx stdctx.Context, app core.App, spec api.ContextSpec, win *api.Window) (PinnedIDs, error) {
	var pinned PinnedIDs

	pinnedFrags, err := resolvePinnedFragments(ctx, app, spec, win)
	if err != nil {
		return pinned, err
	}
	if spec.WholeScope {
		all, err := resolveWholeScope(app, win)
		if err != nil {
			return pinned, err
		}
		pinned.FragmentIDs = all
		// A pin outside the window (or deleted) is not in the scope either —
		// intersect rather than trust the pin list.
		inScope := make(map[string]bool, len(all))
		for _, id := range all {
			inScope[id] = true
		}
		for _, id := range pinnedFrags {
			if inScope[id] {
				pinned.ExpandedIDs = append(pinned.ExpandedIDs, id)
			}
		}
	} else {
		pinned.FragmentIDs = pinnedFrags
		// Recorded even though full mode ignores it: a later flip to
		// summaries keeps the pins in full.
		pinned.ExpandedIDs = append([]string(nil), pinnedFrags...)
	}

	if snapIDs := resolveProjectionSnapshots(ctx, app, spec); len(snapIDs) > 0 {
		pinned.SnapshotIDs = append(pinned.SnapshotIDs, snapIDs...)
	}

	if snapIDs := resolveReflectionSnapshots(ctx, app, spec); len(snapIDs) > 0 {
		pinned.SnapshotIDs = append(pinned.SnapshotIDs, snapIDs...)
	}

	return pinned, nil
}

// windowClause is the fragment-level time filter for a window. The event date
// is source_time (when the email was sent, the note written); a fragment that
// arrived without one falls back to its import time, so nothing silently drops
// out of every window. Empty clause and no params for a nil window.
func windowClause(win *api.Window) (string, dbx.Params) {
	if win == nil || win.Start == "" || win.End == "" {
		return "", dbx.Params{}
	}
	start, err1 := types.ParseDateTime(win.Start)
	end, err2 := types.ParseDateTime(win.End)
	if err1 != nil || err2 != nil || start.IsZero() || end.IsZero() {
		return "", dbx.Params{}
	}
	return " && ((source_time != '' && source_time >= {:ws} && source_time < {:we}) || (source_time = '' && created >= {:ws} && created < {:we}))",
		dbx.Params{"ws": start, "we": end}
}

// resolveWholeScope is every live fragment, windowed.
func resolveWholeScope(app core.App, win *api.Window) ([]string, error) {
	winClause, winParams := windowClause(win)
	recs, err := app.FindRecordsByFilter("fragment", "deleted_at = ''"+winClause, "", 0, 0, winParams)
	if err != nil {
		return nil, fmt.Errorf("resolve WholeScope fragments: %w", err)
	}
	var ids []string
	for _, r := range recs {
		ids = append(ids, r.Id)
	}
	return ids, nil
}

// resolvePinnedFragments is the union of the spec's fragment-level pins:
// explicit ids, legacy types, and colour members — windowed and live.
func resolvePinnedFragments(ctx stdctx.Context, app core.App, spec api.ContextSpec, win *api.Window) ([]string, error) {
	var ids []string
	winClause, winParams := windowClause(win)

	var ors []string
	params := dbx.Params{}
	// Explicitly pinned fragments join the union on equal terms with the rules;
	// the shared `deleted_at = ''` clause below is what drops a pinned fragment
	// once it has been deleted.
	for i, id := range spec.FragmentIDs {
		key := fmt.Sprintf("ef%d", i)
		ors = append(ors, "id = {:"+key+"}")
		params[key] = id
	}
	for i, t := range spec.FragmentTypes {
		key := fmt.Sprintf("ft%d", i)
		ors = append(ors, "type = {:"+key+"}")
		params[key] = t
	}

	cIDs := FragmentIDsForColours(ctx, app, spec.ColourIDs)
	for i, id := range cIDs {
		key := fmt.Sprintf("cf%d", i)
		ors = append(ors, "id = {:"+key+"}")
		params[key] = id
	}

	if len(ors) > 0 {
		for k, v := range winParams {
			params[k] = v
		}
		recs, err := app.FindRecordsByFilter("fragment", "("+strings.Join(ors, " || ")+") && deleted_at = ''"+winClause, "", 0, 0, params)
		if err != nil {
			return nil, fmt.Errorf("resolve specific fragments: %w", err)
		}
		for _, r := range recs {
			ids = append(ids, r.Id)
		}
	}
	return ids, nil
}

// snapshotFilterAndSort decides which upstream snapshot an entity reference
// resolves to. Ordinarily that is the latest *approved* snapshot — the only
// output the upstream has actually published. Inside a speculative chain wave
// (WithChainOrigin) it is the upstream's newest snapshot regardless of status:
// the wave bets that pending candidates will be approved as-is, and because
// approval promotes the record in place (same ID), a downstream snapshot that
// consumed a candidate becomes consistent the moment that candidate lands.
func snapshotFilterAndSort(ctx stdctx.Context, entityFilter string) (filter, sort string) {
	if ChainOriginFromContext(ctx) != "" {
		// "Regardless of status" still excludes rows that are not output:
		// in-flight generation claims and superseded candidates.
		return entityFilter + " && status != 'generating' && status != 'discarded'", "-created"
	}
	return entityFilter + " && status = 'approved'", "-approval_sequence_number"
}

func resolveProjectionSnapshots(ctx stdctx.Context, app core.App, spec api.ContextSpec) []string {
	var ids []string
	if len(spec.SourceProjectionIDs) == 0 {
		return ids
	}
	var ors []string
	params := dbx.Params{}
	for i, pid := range spec.SourceProjectionIDs {
		key := fmt.Sprintf("p%d", i)
		ors = append(ors, "projection_id = {:"+key+"}")
		params[key] = pid
	}
	filter, sort := snapshotFilterAndSort(ctx, "("+strings.Join(ors, " || ")+")")
	if recs, err := app.FindRecordsByFilter("projection_snapshot", filter, sort, 0, 0, params); err == nil {
		seen := make(map[string]bool)
		for _, r := range recs {
			pid := r.GetString("projection_id")
			if !seen[pid] {
				seen[pid] = true
				ids = append(ids, r.Id)
			}
		}
	}
	return ids
}

func resolveReflectionSnapshots(ctx stdctx.Context, app core.App, spec api.ContextSpec) []string {
	var ids []string
	if len(spec.SourceReflectionIDs) == 0 {
		return ids
	}
	var ors []string
	params := dbx.Params{}
	for i, rid := range spec.SourceReflectionIDs {
		key := fmt.Sprintf("r%d", i)
		ors = append(ors, "reflection_id = {:"+key+"}")
		params[key] = rid
	}
	filter, sort := snapshotFilterAndSort(ctx, "("+strings.Join(ors, " || ")+")")
	if recs, err := app.FindRecordsByFilter("reflection_snapshot", filter, sort, 0, 0, params); err == nil {
		seen := make(map[string]bool)
		for _, r := range recs {
			rid := r.GetString("reflection_id")
			if !seen[rid] {
				seen[rid] = true
				ids = append(ids, r.Id)
			}
		}
	}
	return ids
}

// HydrateIDsToText renders a resolved context as prompt text.
func HydrateIDsToText(ctx stdctx.Context, app core.App, pinned PinnedIDs) (string, error) {
	return hydrateFlat(ctx, app, pinned), nil
}

func hydrateFlat(ctx stdctx.Context, app core.App, pinned PinnedIDs) string {
	var sb strings.Builder

	if len(pinned.FragmentIDs) > 0 {
		frags := LoadFragmentsByIDs(ctx, app, pinned.FragmentIDs)
		sb.WriteString(RenderFragmentRecords(frags))
	}

	if len(pinned.SnapshotIDs) > 0 {
		hydrateProjectionSnapshots(ctx, app, pinned.SnapshotIDs, &sb)
		hydrateReflectionSnapshots(ctx, app, pinned.SnapshotIDs, &sb)
	}

	return sb.String()
}

func hydrateProjectionSnapshots(ctx stdctx.Context, app core.App, ids []string, sb *strings.Builder) {
	projSnaps, _ := app.FindRecordsByIds("projection_snapshot", ids)
	var pids []string
	for _, snap := range projSnaps {
		if pid := snap.GetString("projection_id"); pid != "" {
			pids = append(pids, pid)
		}
	}
	if len(pids) == 0 {
		return
	}
	projs, _ := app.FindRecordsByIds("projection", pids)
	projMap := make(map[string]*core.Record)
	for _, p := range projs {
		projMap[p.Id] = p
	}
	for _, snap := range projSnaps {
		pid := snap.GetString("projection_id")
		if proj := projMap[pid]; proj != nil {
			name := proj.GetString("name")
			sb.WriteString(prompts.ProjectionSnapshotBlock(name, snap.Id, pbutil.DecodeJSONString(snap.GetString("output"))))
		}
	}
}

func hydrateReflectionSnapshots(ctx stdctx.Context, app core.App, ids []string, sb *strings.Builder) {
	reflSnaps, _ := app.FindRecordsByIds("reflection_snapshot", ids)
	var rids []string
	for _, snap := range reflSnaps {
		if rid := snap.GetString("reflection_id"); rid != "" {
			rids = append(rids, rid)
		}
	}
	if len(rids) == 0 {
		return
	}
	refls, _ := app.FindRecordsByIds("reflection", rids)
	reflMap := make(map[string]*core.Record)
	for _, r := range refls {
		reflMap[r.Id] = r
	}
	for _, snap := range reflSnaps {
		rid := snap.GetString("reflection_id")
		if refl := reflMap[rid]; refl != nil {
			name := refl.GetString("name")
			sb.WriteString(prompts.ReflectionSnapshotBlock(name, snap.Id, pbutil.DecodeJSONString(snap.GetString("output"))))
		}
	}
}

// LatestPinnedAndSpec reads a transcript's current resolved context, context
// spec and target window — each the newest system part of its type. The window
// is nil for a windowless conversation (projections, unscheduled reflections).
func LatestPinnedAndSpec(msgs []api.UIMessage) (PinnedIDs, api.ContextSpec, *api.Window) {
	var pinned PinnedIDs
	var spec api.ContextSpec
	var win *api.Window
	var gotPinned, gotSpec, gotWinSpec bool
	for i := len(msgs) - 1; i >= 0 && !(gotPinned && gotSpec && gotWinSpec); i-- {
		if msgs[i].Role != "system" {
			continue
		}
		for _, p := range msgs[i].Parts {
			if !gotPinned && p.Type == "pinned_ids" && len(p.Data) > 0 {
				if json.Unmarshal(p.Data, &pinned) == nil {
					gotPinned = true
				}
			}
			if !gotSpec && p.Type == "context_spec" && len(p.Data) > 0 {
				if json.Unmarshal(p.Data, &spec) == nil {
					gotSpec = true
				}
			}
			if !gotWinSpec && p.Type == "window" && len(p.Data) > 0 {
				var w api.Window
				if json.Unmarshal(p.Data, &w) == nil {
					gotWinSpec = true
					if w.Start != "" && w.End != "" {
						win = &w
					}
				}
			}
		}
	}
	return pinned, spec, win
}

// DiffPinnedIDs reports what entered and left the context between two states.
// ExpandedIDs diff too: a fragment already in scope that gets pinned appears
// in added.ExpandedIDs without appearing in added.FragmentIDs.
func DiffPinnedIDs(old, new PinnedIDs) (added, removed PinnedIDs) {
	added.FragmentIDs, removed.FragmentIDs = diffIDs(old.FragmentIDs, new.FragmentIDs)
	added.SnapshotIDs, removed.SnapshotIDs = diffIDs(old.SnapshotIDs, new.SnapshotIDs)
	added.ExpandedIDs, removed.ExpandedIDs = diffIDs(old.ExpandedIDs, new.ExpandedIDs)
	return added, removed
}

// diffIDs is (new − old, old − new), each in its source order.
func diffIDs(old, new []string) (added, removed []string) {
	oldSet := make(map[string]bool, len(old))
	for _, id := range old {
		oldSet[id] = true
	}
	for _, id := range new {
		if !oldSet[id] {
			added = append(added, id)
		}
		delete(oldSet, id)
	}
	for _, id := range old {
		if oldSet[id] {
			removed = append(removed, id)
		}
	}
	return added, removed
}
