# Context Spec Resolution — Generated Audit Snapshot

> **Generated:** 2026-09-02, from source at commit `3998ebd`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The context spec as shared machinery: the spec's shape, how it resolves to a concrete set of fragment and snapshot ids (with and without a time window), how that set is rendered as model text in full and summaries modes, how the resolved set is stored on snapshots and on chat transcripts as a receipt, how two receipts are diffed, and the prompt-size guard applied before any model call. Consumers: chat (`chat.md`), refinement (`refinement.md`), snapshot generation (`lifecycle-projection.md` § 4), staleness (`rotation.md`), the token-count route (`api.md` § 3), and discover's entity listing (`discover.md`). Colour membership itself is in `colours.md`; the map rows summaries mode reads are in `map.md`.

**Completeness anchor.** One resolver, `llmcontext.ResolveSpecToIDs`; two hydrators, `HydrateIDsToText` (full) and `HydrateDeltaToText` (delta, full or summaries); one flattener, `Flatten`; one guard, `engine.CheckPromptFits`.

---

## 1. The spec

`api.ContextSpec` (wire, lowerCamelCase):

| Field | Meaning |
|---|---|
| `wholeScope` | Every live fragment. When true, the five selectors below are **ignored** at resolution. |
| `summaries` | Render mode flag (§ 4). Does not affect which ids resolve. |
| `fragmentIds` | Explicit fragments, by id. A static set: it never grows. |
| `fragmentTypes` | Fragments whose `type` is one of these. |
| `colourIds` | Fragments that are members of any of these colours (§ 2). |
| `sourceProjectionIds` | Upstream projections; each contributes one snapshot id (§ 3). |
| `sourceReflectionIds` | Upstream reflections; each contributes one snapshot id (§ 3). |

A spec is stored as JSON in `projection.current_context_spec` / `reflection.current_context_spec`, `lens.context_spec`, `*_snapshot.context_spec`, and as a `context_spec` part on chat system messages.

## 2. Resolving fragments

`ResolveSpecToIDs(spec, window)` returns `PinnedIDs{fragmentIds, snapshotIds}`.

- **Whole scope:** every `fragment` with `deleted_at = ''`, plus the window clause (§ 2.1).
- **Otherwise:** a single query whose filter is the OR of: `id = <each fragmentIds>`, `type = <each fragmentTypes>`, and `id = <each colour member>`, ANDed with `deleted_at = ''` and the window clause. If all three selector lists are empty no fragment query runs and the fragment set is empty. A pinned fragment that has been soft-deleted therefore drops out like any other.
- **Colour members** are looked up first, in Go: every `colour_fragment` row for any of the colour ids whose `match_type != 'manual_negative'`, deduplicated. `manual_negative` rows are exclusions and never contribute; a fragment excluded from colour A but explicitly listed in `fragmentIds` is still included by the OR. A lookup error is logged and yields no colour members (the spec still resolves).
- Resolution order is the database's; nothing sorts the fragment ids.

### 2.1 The window clause

A non-nil window with both `start` and `end` parseable as PocketBase datetimes adds: `(source_time != '' && source_time >= start && source_time < end) || (source_time = '' && created >= start && created < end)`. Half-open `[start, end)`. A fragment without a `source_time` is placed by its `created` time. A window with an unparseable or empty bound contributes **no** clause (the spec resolves unwindowed, silently). Windows never restrict snapshot ids.

## 3. Resolving upstream snapshots

For each id in `sourceProjectionIds` (and separately `sourceReflectionIds`) the resolver takes **one** snapshot per upstream entity: the first row of a status-filtered query ordered so the newest comes first, deduplicated by parent id. An upstream with no qualifying snapshot contributes nothing (no error, no placeholder).

Which snapshot qualifies depends on the **chain origin** on the context (`llmcontext.WithChainOrigin`):

| Context | Filter | Order |
|---|---|---|
| Ordinary | `status = 'approved'` | `-approval_sequence_number` |
| Chain wave (`generate_all`) | `status != 'generating' && status != 'discarded'` — i.e. pending **or** approved | `-created` |

Only the reconcile wave sets a chain origin (`rotation.md` § 3). For reflections the qualifying snapshot is not restricted by window key: the newest approved snapshot across all windows (or the windowless series) is taken.

Query errors in snapshot resolution are swallowed: the snapshot list is simply shorter.

## 4. Hydration (rendering to text)

**Full mode** (`HydrateIDsToText`): fragments first, each as a `FragmentBlock` (`--- <type> from <source> (ID: <id>) ---` + content) in the order `FindRecordsByIds` returns them (not the pinned order); then projection snapshots (`--- projection "<name>" (ID: <snapshot id>) ---` + decoded output), then reflection snapshots likewise. A snapshot whose parent record no longer exists is skipped silently. Lookup errors are ignored.

**Summaries mode** (`HydrateDeltaToText(…, summaries=true)`, used only for *added* context): fragments render as one line each, sorted by event time (`source_time`, else `created`):

- an annotated fragment → its `fragment_annotation` row: `- <date> · <title> · <summary> (ID: <id>) [things: <name (id)>; …]`, thing citations resolved to current map names where possible;
- an unannotated fragment → a stub: `- <date> · <type> from <source> · "<first 200 runes of content>" (ID: <id>; not yet annotated)`.

All annotation rows are loaded in one pass and matched in Go. Snapshots in summaries mode render exactly as in full mode. Summaries mode is chosen per conversation from the **latest** `context_spec` part on the transcript and applied to every delta in it (`chat.md` § 3).

**Deltas** (`HydrateDeltaToText(added, removed, summaries)`): an added block opens with `AddedNotice` (or `SummariesAddedNotice`, which tells the model to call `read_fragment`); a removed block opens with `RemovedNotice` followed by `- Fragment ID: <id>` / `- Snapshot ID: <id>` lines. Removed items are never re-rendered, only named.

## 5. The receipt: `PinnedIDs`

The resolved set is persisted in two places:

- On every snapshot as `resolved_context` (`{fragmentIds, snapshotIds}`), written by `engine.applySnapshotSpec` at generation and at refinement commit.
- On chat transcripts as a `pinned_ids` system-message part. `chat.ResolveContextSpecs` stamps it onto each incoming system message that carries a `context_spec` and/or `window` part: the pair is cumulative — a window-only message re-resolves the spec already in effect (read from history), and a spec-only message re-resolves under the window in effect. The refinement-create handler seeds the same part when it seeds a spec (`refinement.md` § 2).

`LatestPinnedAndSpec(msgs)` reads a transcript's current state: for each of `pinned_ids`, `context_spec`, `window`, the **newest** system part of that type, independently. A `window` part with empty bounds resets the window to none.

**Diffs.** `PinnedIDs.Diff(other)` = ids in the receiver not in `other` (one-directional; used by staleness). `DiffPinnedIDs(old, new)` returns both added and removed (used by transcript hydration and by the wave's dedup guard). Both compare ids as opaque strings.

## 6. Prompt-size guard

`engine.CheckPromptFits(model, chars)`: estimates tokens as `chars / 4`, asks the model's provider for its `ContextWindow()` (Gemini: 1,000,000; Ollama: 256,000, a constant — the live `num_ctx` probe in `models.md` § 6 is not used here), and refuses when the estimate exceeds `window − window/8`. A provider reporting `0` is never checked. The error is a `ContextTooLargeError` (`the context is about <n> tokens but <model> accepts about <m> — narrow the window or the context`), unwrapping to `ErrContextTooLarge`.

Applied before: chat turns (and again between summaries-mode tool rounds), refinement turns, the lens apply/preview, and snapshot generation. The same `chars / 4` estimate is what `POST /api/context/tokens` reports (`api.md` § 3).

## 7. Mentions and flattening

`Flatten(uiMessages)` turns a persisted UI transcript into model messages. Per message: a message carrying a `data-window_reapply` part is dropped entirely; `text` parts are concatenated after `ExpandMentions`; `tool-update_lens` parts are echoed as `[You called update_lens, setting the lens to:]\n<lens>` (the **only** tool part echoed); `tool-read_fragment` / `tool-read_thing` parts with an output are replayed as the assistant's text + `[You called: <names>]` followed by a `user` message holding the outputs (`chat.md` § 5); every other part type (`tool-apply_result`, `tool-suggest_name`, `data-*`) is invisible to the model.

`ExpandMentions` rewrites the client's wire token `@[Kind:id|Label]` (Kind ∈ Fragment, Projection, Reflection, Colour, Type; id ≤ 32 chars of `[A-Za-z0-9_-]`; label ≤ 80 chars without `]` or newlines) into the prompt forms in `prompts.md` § 1. Anything not matching passes through as literal text. The raw token is what persists; expansion happens only at prompt assembly. Mentions do **not** change resolution — the client is expected to have added the item to the spec.
