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

	fragIDs, err := resolveFragments(ctx, app, spec, win)
	if err != nil {
		return pinned, err
	}
	pinned.FragmentIDs = fragIDs

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

func resolveFragments(ctx stdctx.Context, app core.App, spec api.ContextSpec, win *api.Window) ([]string, error) {
	var ids []string
	winClause, winParams := windowClause(win)
	if spec.WholeScope {
		recs, err := app.FindRecordsByFilter("fragment", "deleted_at = ''"+winClause, "", 0, 0, winParams)
		if err != nil {
			return nil, fmt.Errorf("resolve WholeScope fragments: %w", err)
		}
		for _, r := range recs {
			ids = append(ids, r.Id)
		}
		return ids, nil
	}

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
func DiffPinnedIDs(old, new PinnedIDs) (added, removed PinnedIDs) {
	oldFrags := make(map[string]bool)
	for _, id := range old.FragmentIDs {
		oldFrags[id] = true
	}
	for _, id := range new.FragmentIDs {
		if !oldFrags[id] {
			added.FragmentIDs = append(added.FragmentIDs, id)
		}
		delete(oldFrags, id)
	}
	for id := range oldFrags {
		removed.FragmentIDs = append(removed.FragmentIDs, id)
	}

	oldSnaps := make(map[string]bool)
	for _, id := range old.SnapshotIDs {
		oldSnaps[id] = true
	}
	for _, id := range new.SnapshotIDs {
		if !oldSnaps[id] {
			added.SnapshotIDs = append(added.SnapshotIDs, id)
		}
		delete(oldSnaps, id)
	}
	for id := range oldSnaps {
		removed.SnapshotIDs = append(removed.SnapshotIDs, id)
	}

	return added, removed
}
