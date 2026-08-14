package llmcontext

import (
	stdctx "context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
	"github.com/north-shore-software/kalaido/kalaidoscope/internal/pbutil"
)

func ResolveSpecToIDs(ctx stdctx.Context, app core.App, spec api.ContextSpec) (PinnedIDs, error) {
	var pinned PinnedIDs

	fragIDs, err := resolveFragments(ctx, app, spec)
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

func resolveFragments(ctx stdctx.Context, app core.App, spec api.ContextSpec) ([]string, error) {
	var ids []string
	if spec.WholeScope {
		recs, err := app.FindRecordsByFilter("fragment", "deleted_at = ''", "", 0, 0, nil)
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
		recs, err := app.FindRecordsByFilter("fragment", "("+strings.Join(ors, " || ")+") && deleted_at = ''", "", 0, 0, params)
		if err != nil {
			return nil, fmt.Errorf("resolve specific fragments: %w", err)
		}
		for _, r := range recs {
			ids = append(ids, r.Id)
		}
	}
	return ids, nil
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
	filter := "(" + strings.Join(ors, " || ") + ") && status = 'approved'"
	if recs, err := app.FindRecordsByFilter("projection_snapshot", filter, "-approval_sequence_number", 0, 0, params); err == nil {
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
	filter := "(" + strings.Join(ors, " || ") + ") && status = 'approved'"
	if recs, err := app.FindRecordsByFilter("reflection_snapshot", filter, "-approval_sequence_number", 0, 0, params); err == nil {
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

func HydrateIDsToText(ctx stdctx.Context, app core.App, pinned PinnedIDs) (string, error) {
	var sb strings.Builder

	if len(pinned.FragmentIDs) > 0 {
		frags := LoadFragmentsByIDs(ctx, app, pinned.FragmentIDs)
		sb.WriteString(RenderFragmentRecords(frags))
	}

	if len(pinned.SnapshotIDs) > 0 {
		hydrateProjectionSnapshots(ctx, app, pinned.SnapshotIDs, &sb)
		hydrateReflectionSnapshots(ctx, app, pinned.SnapshotIDs, &sb)
	}

	return sb.String(), nil
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
			fmt.Fprintf(sb, "--- projection %q (ID: %s) ---\n%s\n\n", name, snap.Id, pbutil.DecodeJSONString(snap.GetString("output")))
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
			fmt.Fprintf(sb, "--- reflection %q (ID: %s) ---\n%s\n\n", name, snap.Id, pbutil.DecodeJSONString(snap.GetString("output")))
		}
	}
}

func LatestPinnedAndSpec(msgs []api.UIMessage) (PinnedIDs, api.ContextSpec, api.WindowSpec) {
	var pinned PinnedIDs
	var spec api.ContextSpec
	var winSpec api.WindowSpec
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
			if !gotWinSpec && p.Type == "window_spec" && len(p.Data) > 0 {
				if json.Unmarshal(p.Data, &winSpec) == nil {
					gotWinSpec = true
				}
			}
		}
	}
	return pinned, spec, winSpec
}

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
