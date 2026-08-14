# Kalaido Foundational Changes — Implementation Plan

This is an **implementation plan**, not a scoping document. Follow it in order. Every decision has already been made; nothing below is left to your judgement.

---

## Why these three, and nothing else

A change is *foundational* here if getting it wrong destroys information that cannot be reconstructed later. Three changes qualify:

1. **Fragment soft-delete.** Deletion is live right now (`DELETE /api/collections/fragment/records/{id}` is exposed and no delete hook exists anywhere in the codebase), and `colour_fragment.fragment_id` is declared `CascadeDelete: true`. So deleting a fragment today also destroys its entire tagging history, and any snapshot whose `resolved_context` names it is left pointing at nothing. `model.md` § Deletion & Retention requires the fragment to survive as a tombstone.
2. **Approval sequencing.** `model.md` § Active Snapshot Resolution Rule derives the active snapshot from `MAX(approval_sequence_number)`. The code currently orders by `created`, which is exactly the ordering the spec rules out (batched approvals tie; clocks skew).
3. **Window Spec versioning.** Reflection Snapshots are keyed by `Resolved Window`. Overwriting `current_window_spec` re-keys the grid and detaches every snapshot already generated. `internal/engine/lifecycle.go:116` does exactly this on every refinement commit.

**`generation_timestamp` is part of item 2**, not a fourth item. § Resolution of Staleness turns on when a snapshot's context was *resolved*. Today that coincides with record creation only because generation is synchronous — and `internal/engine/lifecycle.go` already carries a TODO about moving distillation off the request path. The moment it goes async, `created` stops being a valid proxy.

This work is the **reset point**: after it lands, the schema should not need clobbering again.

---

## No migrations, no backfill

There is no production data. **Do not write a migration file.** All schema changes are edits to the declarative `schema` variable in the existing `kalaidoscope/migrations/1748000000_init_schema.go`, so a fresh database is correct from the start.

Consequences you can rely on:

- No field renames, no data rewrites, no backfill loops.
- `current_window_spec` is not migrated to `window_spec_versions` — it simply never exists.
- No snapshot will ever have an empty `status` (`AppendSnapshot` always sets one), so queries filter on `status = 'approved'` with no `|| status = ''` fallback.

Anyone holding a local database deletes it. `./kalaido.sh gen:types` already rebuilds `.schema/pb_data` from scratch on every run, so the type-generation path needs nothing special.

---

## Explicitly NOT in this plan

Do not do any of these, even if you notice them.

| Not in scope | Where it belongs |
|---|---|
| Window grid arithmetic (Duration vs Period, half-open bounds, first-window truncation, materialisation, current-window precedence) | A later pass. This plan installs the *structure* versioning needs; the arithmetic in `engine.CalculatePendingWindows` stays exactly as it is. |
| `source_time` → `event_date` rename | `schema-updates.md` § 1 |
| Fragment field immutability (nilling `CreateRule` / `UpdateRule`) | `schema-updates.md` § 1. **Do not nil `CreateRule`** — `app/src/api/kalaidoscope/fragments.ts` writes the collection directly. |
| `fragment.type` canonical enum | `schema-updates.md` § 1 |
| `status` enum conversion to `SelectField`, retired-candidate states | `schema-updates.md` § 7–8 |
| `approval_policy`, `explicit_fragment_ids`, `Last N`, colour archiving | `schema-updates.md`, `api-updates.md` |
| New endpoints (`GET /api/projections/{id}` etc.) | `api-updates.md` § 3–4 |
| Tests | Not requested. Write none. |

---

## Rules while working

- **Write no comments.** None, anywhere.
- Smallest diff that works. Edit; do not rewrite files.
- **No git operations.** Do not commit, branch, or stage.
- If you hit something this plan does not cover, or two readings are possible, **stop and report**. Do not guess and do not "do it this way for now".
- Verify after every phase before starting the next.

Baseline (run from repo root; must pass before you start):

```
./kalaido.sh check:go && ./kalaido.sh build:sidecar
```

---

## Phase 1 — Schema

All edits are to the `schema` variable in `kalaidoscope/migrations/1748000000_init_schema.go`. The `indexDef` struct already supports a `Where` clause, and `ensureCollection` already passes it to `AddIndex`. Nothing in the migration machinery needs changing.

### 1.1 `fragment`

Add one field and one index:

```go
&core.DateField{Name: "deleted_at"},
```

```go
{Name: "idx_fragment_deleted_at", Columns: "deleted_at"},
```

### 1.2 `view_stream`

Add a `WHERE` clause to the existing `ViewQuery`, as the last line before the closing backtick:

```
FROM fragment f
WHERE f.deleted_at = ''
```

Leave `f.source_time` alone — the rename is not in this plan.

**Empty PocketBase `DateField` values compare against `''`, not `NULL`.** Use `= ''` for "not deleted" everywhere in this plan.

### 1.3 `projection_snapshot`

Add three fields:

```go
&core.NumberField{Name: "approval_sequence_number"},
&core.DateField{Name: "approval_timestamp"},
&core.DateField{Name: "generation_timestamp"},
```

Add one index:

```go
{Name: "idx_projection_snapshot_approval_seq", Unique: true, Columns: "projection_id, approval_sequence_number", Where: "status = 'approved'"},
```

### 1.4 `reflection_snapshot`

Add five fields:

```go
&core.NumberField{Name: "approval_sequence_number"},
&core.DateField{Name: "approval_timestamp"},
&core.DateField{Name: "generation_timestamp"},
&core.TextField{Name: "window_key"},
&core.NumberField{Name: "window_spec_version_number"},
```

Add one index:

```go
{Name: "idx_reflection_snapshot_approval_seq", Unique: true, Columns: "reflection_id, window_key, approval_sequence_number", Where: "status = 'approved'"},
```

`window_key` is required, not optional: a Reflection's Staleness Target is the individual window (`model.md` § Core Concept: Staleness Target), so per-window uniqueness cannot be expressed without a scalar key. `resolved_window` is a `JSONField` and is neither groupable nor indexable.

**`window_key` format is `{start}_{end}` with both timestamps in RFC3339.** Example: `2023-12-01T00:00:00Z_2023-12-02T00:00:00Z`. This matches the `window_id` recommendation in `api-updates.md` § 5. Do not use a hash.

### 1.5 `reflection`

**Replace** the existing field

```go
&core.JSONField{Name: "current_window_spec"},
```

with

```go
&core.JSONField{Name: "window_spec_versions"},
```

`current_window_spec` must not remain. Leaving a second writable copy of the window spec is the exact defect this plan exists to eliminate.

### 1.6 Verify Phase 1

```
./kalaido.sh check:go && ./kalaido.sh gen:types
```

`gen:types` rebuilds the schema database from scratch and rewrites `app/src/api/kalaidoscope/types.ts`. Confirm `ReflectionRecord` now carries `window_spec_versions` and no longer carries `current_window_spec`. `./kalaido.sh check:ts` will now fail on the frontend sites fixed in § 4.5 — that is expected until then.

---

## Phase 2 — Fragment soft-delete behaviour

### 2.1 Delete interception

In `kalaidoscope/server/server.go`, inside `RegisterTriggers`, add after the existing `OnRecordAfterCreateSuccess("fragment")` block:

```go
app.OnRecordDeleteRequest("fragment").BindFunc(func(e *core.RecordRequestEvent) error {
	if e.Record.GetDateTime("deleted_at").IsZero() {
		e.Record.Set("deleted_at", types.NowDateTime())
		if err := e.App.Save(e.Record); err != nil {
			return err
		}
	}
	return e.NoContent(http.StatusNoContent)
})
```

Add `"net/http"` to the imports. `types` is already imported.

**Do not call `e.Next()` in this handler.** Calling it performs the real delete, which is the whole thing being prevented. Returning without `Next()` cancels the chain.

The hook is `OnRecordDeleteRequest` — the PocketBase v0.27 name. Older documentation and `api-updates.md` § 9 refer to `OnRecordBeforeDeleteRequest`, which does not exist in this version.

Re-deleting an already-deleted fragment returns `204` without touching `deleted_at`. That is intended.

### 2.2 Exclude deleted fragments from context resolution

In `kalaidoscope/internal/llmcontext/resolve.go`, function `resolveFragments`:

- Whole-scope branch: change the filter `"1=1"` to `"deleted_at = ''"`.
- Filtered branch: change

  ```go
  recs, err := app.FindRecordsByFilter("fragment", strings.Join(ors, " || "), "", 0, 0, params)
  ```

  to

  ```go
  recs, err := app.FindRecordsByFilter("fragment", "("+strings.Join(ors, " || ")+") && deleted_at = ''", "", 0, 0, params)
  ```

This one filter covers colour-matched fragments too: `FragmentIDsForColours` returns ids that are then re-queried against the `fragment` table through the `ors` clause, so the condition applies to them as well.

**Do not add a `deleted_at` filter to `LoadFragmentsByIDs`.** Historical snapshots must still render the text of a fragment that was later deleted — that is what makes the tombstone useful. Only *resolution* excludes deleted fragments; *hydration* does not.

### 2.3 Verify Phase 2

```
./kalaido.sh check:go && ./kalaido.sh build:sidecar
```

Against a running server: create a fragment, `DELETE` it, confirm it still exists as a row with `deleted_at` populated, that `view_stream` no longer lists it, and that its `colour_fragment` rows survive.

---

## Phase 3 — Approval sequencing

### 3.1 Assign sequence numbers on approval

In `kalaidoscope/internal/engine/lifecycle.go`, replace `ApproveSnapshot` entirely:

```go
func ApproveSnapshot(ctx context.Context, app core.App, strat Strategy, snapshotID string) error {
	return app.RunInTransaction(func(txApp core.App) error {
		snap, err := txApp.FindRecordById(strat.SnapshotCollectionName(), snapshotID)
		if err != nil {
			return err
		}
		if snap.GetInt("approval_sequence_number") > 0 {
			return nil
		}
		seq, err := nextApprovalSequence(txApp, strat, snap)
		if err != nil {
			return err
		}
		snap.Set("approval_sequence_number", seq)
		snap.Set("approval_timestamp", types.NowDateTime())
		snap.Set("status", StatusApproved)
		return txApp.Save(snap)
	})
}

func nextApprovalSequence(app core.App, strat Strategy, snap *core.Record) (int, error) {
	filter := strat.ForeignKeyCol() + " = {:parent} && status = 'approved'"
	params := dbx.Params{"parent": snap.GetString(strat.ForeignKeyCol())}
	if strat.TargetType() == "reflection" {
		filter += " && window_key = {:wk}"
		params["wk"] = snap.GetString("window_key")
	}
	recs, err := app.FindRecordsByFilter(
		strat.SnapshotCollectionName(), filter, "-approval_sequence_number", 1, 0, params)
	if err != nil {
		return 0, err
	}
	if len(recs) == 0 {
		return 1, nil
	}
	return recs[0].GetInt("approval_sequence_number") + 1, nil
}
```

Add imports `"github.com/pocketbase/dbx"` and `"github.com/pocketbase/pocketbase/tools/types"`.

The guard is `approval_sequence_number > 0`, **not** `status == "approved"`. `AppendSnapshot` may already have written `status: "approved"` before `ApproveSnapshot` runs, so a status-based guard would skip sequence assignment entirely. This is the single easiest mistake to make in this phase.

The unique partial index is what enforces the spec's serialisation requirement — if two approvals race, one fails on the constraint rather than producing a duplicate sequence number. That is intended; do not catch and retry.

### 3.2 Record the generation timestamp and window key

In `kalaidoscope/internal/engine/lifecycle.go`, add two fields to the `SnapshotSpec` struct:

```go
WindowKey              string
WindowSpecVersionNumber int
```

In `AppendSnapshot`, before `app.Save(snap)`:

```go
snap.Set("generation_timestamp", types.NowDateTime())
```

and extend the existing reflection branch:

```go
if collectionName == "reflection_snapshot" {
	if s.WindowSpec != nil {
		snap.Set("window_spec", pbutil.JSONObject(s.WindowSpec))
	}
	if s.ResolvedWindow != nil {
		snap.Set("resolved_window", pbutil.JSONObject(s.ResolvedWindow))
		snap.Set("window_key", s.WindowKey)
	}
	snap.Set("window_spec_version_number", s.WindowSpecVersionNumber)
}
```

In `kalaidoscope/internal/engine/snapshot.go`, `GenerateSnapshot` already builds `resWin` for reflections. Set the key from the same window:

```go
var winKey string
if window != nil {
	resWin = map[string]string{"start": window.Start, "end": window.End}
	winKey = window.Start + "_" + window.End
}
```

and pass `WindowKey: winKey` in the `SnapshotSpec` literal.

### 3.3 Make `CommitRefinement` assign a sequence

`CommitRefinement` calls `AppendSnapshot` with `Status: StatusApproved` and never calls `ApproveSnapshot`, so its snapshot would get no sequence number. Immediately after the `AppendSnapshot` call succeeds, add:

```go
if err := ApproveSnapshot(ctx, app, strat, newSnapID); err != nil {
	return "", err
}
```

### 3.4 Derive "active" from the sequence number

Four places currently pick the active snapshot by `-created`. In each, change the filter to `status = 'approved'` and the sort to `"-approval_sequence_number"`.

| File | Function | Current filter / sort |
|---|---|---|
| `internal/llmcontext/resolve.go` | `resolveProjectionSnapshots` | `... && (status = 'approved' \|\| status = '')`, sort `-created` |
| `internal/llmcontext/resolve.go` | `resolveReflectionSnapshots` | same |
| `internal/status/status.go` | `evaluateNode` (two call sites — the main lookup and the dependency check) | same |
| `internal/engine/reflections.go` | `GetPendingWindows` | same |

The `|| status = ''` clause goes away entirely: on a fresh database no snapshot is ever written without a status.

**`resolveReflectionSnapshots` keeps its existing "one snapshot per reflection" behaviour.** Implementing `Last N` is not in this plan.

### 3.5 Verify Phase 3

```
./kalaido.sh check:go && ./kalaido.sh build:sidecar
```

Against a running server: approve two snapshots for one projection and confirm sequence numbers 1 then 2; approve snapshots for two different windows of one reflection and confirm each window's sequence starts at 1; confirm `generation_timestamp` is populated on every snapshot.

---

## Phase 4 — Window Spec versioning

### 4.1 Types

In `kalaidoscope/internal/api/context.go`, extend `WindowSpec` and add the version wrapper:

```go
type WindowSpec struct {
	Mode      string `json:"mode,omitempty"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime,omitempty"`
	Period    string `json:"period"`
	Duration  string `json:"duration"`
}

type WindowSpecVersion struct {
	VersionNumber int        `json:"versionNumber"`
	EffectiveFrom string     `json:"effectiveFrom"`
	Spec          WindowSpec `json:"spec"`
}
```

`Mode` is `"relative"` or `"absolute"`; empty means `"relative"`.

### 4.2 Version helpers

Create `kalaidoscope/internal/engine/windowspec.go`:

```go
package engine

import (
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/north-shore-software/kalaido/kalaidoscope/internal/api"
)

func LoadWindowSpecVersions(rec *core.Record) []api.WindowSpecVersion {
	var versions []api.WindowSpecVersion
	_ = rec.UnmarshalJSONField("window_spec_versions", &versions)
	return versions
}

func GoverningVersion(versions []api.WindowSpecVersion, at time.Time) (api.WindowSpecVersion, bool) {
	var best api.WindowSpecVersion
	var bestAt time.Time
	var found bool
	for _, v := range versions {
		eff, err := time.Parse(time.RFC3339, v.EffectiveFrom)
		if err != nil || eff.After(at) {
			continue
		}
		if !found || eff.After(bestAt) {
			best = v
			bestAt = eff
			found = true
		}
	}
	return best, found
}

func AppendWindowSpecVersion(versions []api.WindowSpecVersion, spec api.WindowSpec, effectiveFrom time.Time) []api.WindowSpecVersion {
	next := 1
	for _, v := range versions {
		if v.VersionNumber >= next {
			next = v.VersionNumber + 1
		}
	}
	return append(versions, api.WindowSpecVersion{
		VersionNumber: next,
		EffectiveFrom: effectiveFrom.UTC().Format(time.RFC3339),
		Spec:          spec,
	})
}
```

`GoverningVersion` implements only "the latest version whose Effective From is at or before this point" (`model.md` § Window Spec Versions). It is **not** current-window precedence across overlapping versions, which is grid logic and out of scope.

### 4.3 Seed version 1 at creation

A Reflection's first version's Effective From is its creation time (`model.md` § Reflection → Anatomy & State). In `kalaidoscope/internal/handlers/synthesis.go`, `handleCreate`, after `rec.Set("name", req.Name)` and before `txApp.Save(rec)`:

```go
if strat.TargetType() == "reflection" {
	versions := engine.AppendWindowSpecVersion(nil, api.WindowSpec{}, time.Now())
	rec.Set("window_spec_versions", pbutil.JSONObject(versions))
}
```

`api` and `engine` are already imported in that file; add only `"time"` and `pbutil`. The seeded version carries an empty spec — the Reflection is unscheduled until a `PATCH` supplies one, which matches today's behaviour where `current_window_spec` starts empty.

### 4.4 Replace every read of `current_window_spec`

Three sites read it. All become: load versions, take the governing version, use its `Spec`.

**`internal/engine/reflections.go`, `GetPendingWindows`** — replace

```go
var currentSpec api.WindowSpec
if err := rec.UnmarshalJSONField("current_window_spec", &currentSpec); err != nil || currentSpec.Period == "" {
	return nil, nil
}
```

with

```go
version, ok := GoverningVersion(LoadWindowSpecVersions(rec), time.Now())
if !ok || version.Spec.Period == "" {
	return nil, nil
}
currentSpec := version.Spec
```

**`internal/engine/snapshot.go`, `GenerateSnapshot`** — replace

```go
var currentWindowSpec api.WindowSpec
_ = rec.UnmarshalJSONField("current_window_spec", &currentWindowSpec)
winSpec = currentWindowSpec
```

with

```go
if version, ok := GoverningVersion(LoadWindowSpecVersions(rec), time.Now()); ok {
	winSpec = version.Spec
	specVersionNumber = version.VersionNumber
}
```

Declare `var specVersionNumber int` alongside `winSpec`, and pass `WindowSpecVersionNumber: specVersionNumber` in the `SnapshotSpec` literal.

**`internal/status/status.go`, `evaluateNode`** — replace

```go
var currentSpec api.WindowSpec
if err := n.record.UnmarshalJSONField("current_window_spec", &currentSpec); err == nil && currentSpec.Period != "" {
```

with

```go
version, ok := engine.GoverningVersion(engine.LoadWindowSpecVersions(n.record), e.now)
if ok && version.Spec.Period != "" {
	currentSpec := version.Spec
```

`engine` is already imported there. Use `e.now`, not `time.Now()` — the evaluator carries its own clock.

### 4.5 Stop `CommitRefinement` writing the window spec

In `kalaidoscope/internal/engine/lifecycle.go`, `CommitRefinement` contains:

```go
if targetCol == "reflection" {
	parentRec.Set("current_window_spec", pbutil.JSONObject(winSpec))
}
```

**Delete these three lines.** Approving a refinement is not a Window Spec edit (`model.md` § Staleness Triggers explicitly separates them), and this line is the live instance of the defect: it silently overwrites the grid from whatever the chat happened to carry.

Leave the `winSpec` parameter on the function signature and its use in `AppendSnapshot` — the snapshot still records the spec it was generated under.

### 4.6 Append a version on PATCH

In `kalaidoscope/internal/handlers/synthesis.go`, `handleUpdate`, extend the request body:

```go
type reqBody struct {
	Name       *string         `json:"name,omitempty"`
	Pinned     *bool           `json:"pinned,omitempty"`
	WindowSpec *api.WindowSpec `json:"windowSpec,omitempty"`
}
```

After the existing `Name` handling, before `app.Save(rec)`:

```go
if req.WindowSpec != nil {
	if strat.TargetType() != "reflection" {
		return e.BadRequestError("windowSpec is only valid for reflections", nil)
	}
	versions := engine.AppendWindowSpecVersion(
		engine.LoadWindowSpecVersions(rec), *req.WindowSpec, time.Now())
	rec.Set("window_spec_versions", pbutil.JSONObject(versions))
}
```

Imports are already covered by § 4.3.

**Append only. Never modify or remove an existing element of the array**, and never set `EffectiveFrom` to a past time — `model.md` § Key Parameters says it is "never backdated".

A Window Spec edit must **not** mark candidates obsolete and must **not** flag anything stale. Those belong to Context Spec edits and are out of scope here.

### 4.7 Update the frontend reads

Four frontend sites reference `current_window_spec`. They would fail **silently** — `parseWindowSpec(undefined)` returns `null` and both helpers fall back to defaults, so the reflection UI would quietly display the wrong schedule rather than erroring.

In `app/src/features/reflections/schedule.ts`, add an exported helper:

```ts
export function currentWindowSpec(raw: unknown): unknown {
  let versions: unknown = raw;
  if (typeof raw === "string") {
    try {
      versions = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const latest = versions.reduce((a, b) =>
    (b?.versionNumber ?? 0) > (a?.versionNumber ?? 0) ? b : a,
  );
  return latest?.spec ?? null;
}
```

Then update the three call sites:

| File | Line | Change |
|---|---|---|
| `app/src/features/reflections/components/reflection-detail-panel.tsx` | 97 | `windowSpecToChips(currentWindowSpec(reflection.window_spec_versions))` |
| `app/src/features/reflections/components/reflection-detail-panel.tsx` | 203 | `describeWindow(currentWindowSpec(reflection?.window_spec_versions))` |
| `app/src/features/reflections/pages/Reflections.tsx` | 69 | `describeWindow(currentWindowSpec(r.window_spec_versions))` |

Also correct the two stale comments in `schedule.ts` (lines 6 and 50) describing the schedule as living on `current_window_spec` and being written only by committing a refinement. Both become false: it lives on `window_spec_versions`, and § 4.6 adds a direct `PATCH` write path. Correct the wording; do not add new commentary.

`currentWindowSpec` picks the highest `versionNumber` rather than evaluating `effectiveFrom` against the clock — a future-dated version would display before it takes effect. That is a known, accepted simplification: this is a display path, not the grid.

### 4.8 Verify Phase 4

```
./kalaido.sh check:go && ./kalaido.sh check:ts && ./kalaido.sh build:sidecar
grep -rn "current_window_spec" kalaidoscope/ app/src
```

The `grep` must return **nothing**. Any hit is a site that was missed and will silently read an empty spec at runtime.

Against a running server: create a reflection and confirm `window_spec_versions` holds one entry; `PATCH` its `windowSpec` and confirm the array grows to two with the first untouched; confirm a snapshot generated afterwards records `window_spec_version_number: 2`.

---

## Final verification

```
./kalaido.sh check:go
./kalaido.sh test:go
./kalaido.sh check:ts
./kalaido.sh test:ts
./kalaido.sh build:sidecar
./kalaido.sh gen:types
./kalaido.sh check:schema-freshness
```

Run `gen:types` **before** `check:schema-freshness` — the latter fails until `types.ts` matches the migrations. `test:go` currently has no tests to run and should pass trivially.

---

## Decisions already made — do not revisit

| Question | Decision |
|---|---|
| Write a new migration file? | No. Edit the `schema` variable in `1748000000_init_schema.go`. |
| Backfill or migrate existing rows? | No. There is no data. |
| `window_key` format | `{start}_{end}`, RFC3339 both sides. Not a hash. |
| Keep `current_window_spec` alongside the versions array? | No. It never exists. |
| Guard condition in `ApproveSnapshot` | `approval_sequence_number > 0`. Not status. |
| Keep the `\|\| status = ''` filter fallback? | No. Remove it everywhere. |
| Filter deleted fragments in `LoadFragmentsByIDs`? | No. Resolution excludes them; hydration does not. |
| Nil the fragment `CreateRule`? | No — the frontend writes the collection directly. |
| Implement `Last N` while touching `resolveReflectionSnapshots`? | No. |
