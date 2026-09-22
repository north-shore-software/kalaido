> **STALE** — code has changed since this document was generated.

# Context Spec Resolution — Generated Audit Snapshot

> **Generated:** 2026-09-17, from source at commit `895984c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The context spec as shared machinery: the spec's shape and mode values, how it resolves to a concrete set of fragment and snapshot ids (with and without a time window) and which of those are marked as pinned, how that set is rendered as model text in full and summaries modes against a conversation's final context, how the resolved set is stored on snapshots and on transcripts as a receipt, how two receipts are diffed, and the prompt-size guard applied before model calls. Consumers: chat (`chat.md` § 3, § 5), refinement (`refinement.md` § 2, § 3.1, § 4, § 5), snapshot generation (`lifecycle-projection.md` § 4.2, `lifecycle-reflection.md` § 5.2), staleness and the wave (`rotation.md` § 2, § 3), the token-count route (`api.md` § 3), and discover's entity listing (`discover.md` § 3.1). Colour membership itself is in `colours.md` § 2; the annotation rows and map document that summaries mode reads are in `map.md` § 4; the summaries-mode chat turn (seeding, read tools, replay) is in `chat.md` § 5.

**Completeness anchor.** `api.ContextSpec` (`internal/api/context.go`) has exactly six fields — `wholeScope`, `fragmentIds`, `fragmentTypes`, `colourIds`, `sourceProjectionIds`, `sourceReflectionIds` — and `WholeScopeMode` exactly two named values, `full` and `summaries`, beside its zero value; all six fields and all three mode values are described in § 1. One resolver, `llmcontext.ResolveSpecToIDs`; one flat hydrator, `HydrateIDsToText`; one delta hydrator, `Hydrator` (built by `NewHydrator`, single-shot form `HydrateDeltaToText`); one flattener, `Flatten`; one guard, `engine.CheckPromptFits`, called from exactly seven sites (§ 6). `internal/llmcontext/` exports fourteen functions (`ResolveSpecToIDs`, `HydrateIDsToText`, `LatestPinnedAndSpec`, `DiffPinnedIDs`, `NewHydrator`, `HydrateDeltaToText`, `Flatten`, `RenderFragmentRecords`, `LoadFragmentsByIDs`, `FragmentIDsForColours`, `WithGenerationTrigger`, `GenerationTriggerFromContext`, `ExpandMentions`, `StripMentions`) and three methods (`Hydrator.Delta`, `PinnedIDs.IsEmpty`, `PinnedIDs.Diff`); each is described in the section named beside it below.

---

## 1. The spec

`api.ContextSpec` (wire, lowerCamelCase; every field `omitempty`, so an empty spec serialises as `{}`):

| Field | Meaning |
|---|---|
| `wholeScope` | A `WholeScopeMode` string. Empty: not whole scope — the fragment-level selectors below **are** the fragment context. Non-empty: every live fragment is in scope and the three fragment-level selectors add nothing to the scope but mark which fragments are **pinned** (§ 2, § 4). Named values: `"full"` and `"summaries"`. Resolution tests only `!= ""`; hydration and the prompt choice test only `== "summaries"`. Nothing validates the value — any other non-empty string resolves as whole scope and renders as full. |
| `fragmentIds` | Explicit fragments, by id. A static set: it never grows. |
| `fragmentTypes` | Fragments whose `type` is one of these. |
| `colourIds` | Fragments that are members of any of these colours (§ 2). |
| `sourceProjectionIds` | Upstream projections; each contributes at most one snapshot id (§ 3). Contributes even under whole scope, which never includes snapshots on its own. |
| `sourceReflectionIds` | Upstream reflections; likewise. |

The mode is therefore carried by `wholeScope` itself: `""` (selectors only), `"full"` (whole scope, bodies), `"summaries"` (whole scope, rows for everything not pinned). A spec with every field empty resolves to an empty receipt (§ 2): no fragment query runs and no snapshot query runs.

A spec is stored as JSON in `projection.current_context_spec` / `reflection.current_context_spec`, on every snapshot as `projection_snapshot.context_spec` / `reflection_snapshot.context_spec`, and as a `context_spec` part on system messages of chat and refinement transcripts. The `lens` collection carries no spec. Writers of the entity spec: the entity routes (`lifecycle-projection.md` § 7, `lifecycle-reflection.md` § 3), refinement commit (`refinement.md` § 5), the hand-edit path (which appends the new edit fragment's id to `fragmentIds` on both the entity spec and the new snapshot's spec, `lifecycle-projection.md` § 4.2), and the scrubbers that drop a deleted colour or soft-deleted upstream id from every `current_context_spec` that contains it (`colours.md` § 6).

## 2. Resolving fragments

`ResolveSpecToIDs(ctx, app, spec, window)` returns `PinnedIDs{fragmentIds, snapshotIds, expandedIds}` or an error.

- **Pinned fragments** are always computed first (`resolvePinnedFragments`): a single `fragment` query whose filter is the OR of `id = <each fragmentIds>`, `type = <each fragmentTypes>`, and `id = <each colour member>`, ANDed with `deleted_at = ''` and the window clause (§ 2.1). If all three selector lists are empty (after colour lookup) no query runs and the pinned set is empty. A pinned fragment that has been soft-deleted drops out like any other. A fragment matched by several selectors appears once. A query error fails the whole resolution (`resolve specific fragments: …`).
- **Whole scope** (`wholeScope != ""`): `fragmentIds` = every `fragment` with `deleted_at = ''` plus the window clause (a query error fails the resolution: `resolve WholeScope fragments: …`); `expandedIds` = the pinned fragments that are also in that set, in pinned order (a pin outside the window, or deleted, is not expanded).
- **Otherwise:** `fragmentIds` = the pinned fragments; `expandedIds` = a copy of the same list (recorded even though full mode ignores it, so a later switch to summaries keeps the pins in full).
- **Colour members** (`FragmentIDsForColours`): every `colour_fragment` row whose `colour_id` is one of the colour ids and whose `match_type != 'manual_negative'`, deduplicated by `fragment_id`; rows with an empty `fragment_id` are skipped. `manual_negative` rows are exclusions and never contribute; a fragment excluded from colour A but explicitly listed in `fragmentIds` (or matched by type) is still included by the OR. A lookup error is logged (`colour: FragmentIDsForColours: …`) and yields no colour members — the spec still resolves.
- Order is the database's; nothing sorts the fragment ids.

### 2.1 The window clause

`windowClause(win)`: a nil window, or one with an empty `start` or `end`, contributes nothing. Both bounds are parsed with `types.ParseDateTime`; if either fails to parse or is zero, the clause is again empty (the spec resolves unwindowed, silently). Otherwise: `((occurred_at != '' && occurred_at >= start && occurred_at < end) || (occurred_at = '' && created >= start && created < end))` — half-open `[start, end)`; a fragment without an `occurred_at` is placed by its `created` time. The window's `id` is not read. Windows never restrict snapshot ids.

## 3. Resolving upstream snapshots

For each id in `sourceProjectionIds` (and separately `sourceReflectionIds`) the resolver takes **one** snapshot per upstream entity: one status-filtered query over `projection_snapshot` (`reflection_snapshot`) whose filter is the OR of `projection_id = <id>` (`reflection_id = <id>`) ANDed with `projection_id.deleted_at = ''` (`reflection_id.deleted_at = ''`) — a soft-deleted upstream contributes nothing until restored — ordered newest first, then deduplicated by parent id. An upstream with no qualifying snapshot contributes nothing (no error, no placeholder). Projection snapshot ids come first, then reflection snapshot ids.

Which snapshot qualifies depends on the **generation trigger** marked on the context (`llmcontext.WithGenerationTrigger`; read back by `GenerationTriggerFromContext`, `""` when unset):

| Context | Filter | Order |
|---|---|---|
| Ordinary (no trigger) | `status = 'approved'` | `-approval_sequence_number` |
| Any non-empty trigger — in practice `TriggerGenerateAll` = `"generate_all"` | `status != 'generating' && status != 'discarded'` — i.e. `pending_review` **or** `approved` | `-created` |

Only the reconcile wave sets the trigger (`rotation.md` § 3); the same value is stamped into the snapshot's `generation_trigger` field when a generation under that context is stored (`lifecycle-projection.md` § 4.2). For reflections the qualifying snapshot is not restricted by window key: the newest approved (or pending) snapshot across all windows and the windowless series is taken.

Query errors in snapshot resolution are swallowed: the snapshot list is simply shorter and the resolution still succeeds.

## 4. Hydration (rendering to text)

**Flat** (`HydrateIDsToText`, always returns a nil error): fragments first, loaded with `LoadFragmentsByIDs` — `FindRecordsByIds("fragment", fragmentIds)` (an error yields no fragments, silently; there is no `deleted_at` filter at this stage — liveness was decided at resolution) and rendered in the order that lookup returns them, each as `prompts.FragmentBlock(type, source, id, content)` — `--- <type> from <source> (ID: <id>) ---` + content, with `EditFragmentGuidance` inserted between header and body for the `edit` type (`prompts.md` § 1). Then projection snapshots: `FindRecordsByIds("projection_snapshot", snapshotIds)`, their parents loaded in one batch, each rendered as `ProjectionSnapshotBlock(name, snapshotId, output)` (`--- projection "<name>" (ID: <snapshot id>) ---`); a snapshot whose parent is missing or has a non-zero `deleted_at` is skipped silently. Then reflection snapshots likewise. All lookup errors are ignored. `expandedIds` plays no part.

Flat hydration is used for:

- the generation source block (`prepareGenerationContext`, `lifecycle-projection.md` § 4.2): the entity's `current_context_spec` is resolved under the generation's window; a resolution **error** leaves the source block and the receipt empty without failing the generation; an empty resolved set likewise hydrates nothing; for reflections (`EnsureFragmentsOnly`) a resolved set containing any snapshot id fails the generation with `this context must contain fragments only, but snapshots were provided`;
- the refinement apply leg and window re-apply (`refinement.md` § 3.1, § 4): the transcript's newest `pinned_ids` (§ 5) hydrated flat whatever the spec's mode, skipped when the receipt is empty;
- outside this package, `RenderFragmentRecords` alone renders example and target fragments for the colour prompt (`colours.md` § 4) and the `read_fragment` tool output (`discover.md` § 3.3).

**Deltas** (`Hydrator`, used for transcripts): `chat.HydrateDeltaHistory` builds one hydrator per prompt assembly from the transcript's **final** receipt and **final** mode (`LatestPinnedAndSpec`, § 5; mode = `wholeScope == "summaries"`), then feeds every `(added, removed)` step of the transcript in order to `Hydrator.Delta` — the diff between consecutive `pinned_ids` parts (`DiffPinnedIDs`, § 5); a system message without a parseable `pinned_ids` part yields no delta, and a system message carrying a `window` part with both bounds is prefixed with `WindowNotice(start, end)` (`prompts.md` § 1) whether or not it carries a receipt. The same function serves refinement transcripts (`refinement.md` § 3). How an added fragment renders is decided by that final state, not by the mode in force when it arrived:

| Added fragment is… | Rendered as |
|---|---|
| not in the final `fragmentIds` | omitted; counted into `OmittedAddedNotice(n)` |
| already rendered earlier in this transcript (left and came back) | not re-rendered; counted into `RestoredNotice(n)` |
| in the final set, and (final mode is not summaries **or** the id is in the final `expandedIds`) | its full `FragmentBlock` under `AddedNotice` |
| in the final set, otherwise (summaries mode, not pinned) | one summaries row under `SummariesAddedNotice` |

Added snapshots always render in full under `AddedNotice` (the same block as the full fragments). A removed fragment is listed as `- Fragment ID: <id>` under `RemovedNotice` only if it is currently shown to the model; removed fragments never shown are counted into `OmittedRemovedLine(n)` under the same notice; removed snapshots are always listed as `- Snapshot ID: <id>`. Removed items are never re-rendered, only named. The order within one delta is: added notice + blocks, summaries notice + rows, restored notice, omitted-added notice, removed notice + lines.

**Summaries rows** (`hydrateSummaries`): every `fragment_annotation` row is loaded in one pass (`mapping.LoadRows`, `map.md` § 4) and matched to the added ids in Go; a row-load failure fails that delta with an error, which `HydrateDeltaHistory` discards — the delta text is simply empty for that step. The map document is loaded for thing names; a failure leaves the name table empty, silently. The fragments themselves are loaded by id and sorted by event time (`occurred_at`, else `created`, compared as strings):

- an annotated fragment → `- <date> · <title> · <summary, trimmed> (ID: <fragment id>)`, followed by ` [things: <cite>; …]` when the row cites things — a citation with a `ref` renders as `<map name> (<ref>)` when the ref is in the current map, else the bare ref; a citation with only a `name` renders that name. The row's date is the fragment's `occurred_at` day as `LoadRows` recorded it; a row without one prints `undated`;
- an unannotated fragment → `- <date> · <type> from <source> · "<snippet>" (ID: <id>; not yet annotated)`, where the date is the `occurred_at` day, else the `created` day, else `undated`, and the snippet is the content with whitespace collapsed to single spaces, cut to 200 runes with `…` appended when longer.

The block ends with one blank line.

`HydrateDeltaToText(added, removed, summaries)` is the single-shot form — a hydrator whose final context is `added` — used by the token estimate's spec form (§ 6).

## 5. The receipt: `PinnedIDs`

`PinnedIDs{fragmentIds, snapshotIds, expandedIds}` (all `omitempty`; an empty receipt serialises as `{}`). It is persisted in two places:

- On every snapshot as `resolved_context`, always beside `context_spec`, by `engine.applySnapshotSpec` — when a claimed generation completes, when refinement commit appends its approved snapshot (`refinement.md` § 5), and when a hand edit appends its pending snapshot (the edit copies the source snapshot's receipt and adds the new fragment id to both `fragmentIds` and `expandedIds`) — and by `settleApprovedInPlace`, which rewrites `context_spec` and `resolved_context` on the standing approved snapshot when a wave regeneration reproduces its output (`lifecycle-projection.md` § 4.2). `expandedIds` rides along because the whole struct is serialised; no reader diffs it, and the hand-edit path is the only one that carries it forward (copied, with the new fragment id appended). Readers: the staleness evaluator (`rotation.md` § 2), the wave's `SnapshotIsCurrent` check, and the hand-edit path.
- On chat and refinement transcripts as a `pinned_ids` system-message part. `chat.ResolveContextSpecs(history, newMsgs)` starts from the spec and window in effect at the end of `history` (`LatestPinnedAndSpec`) and walks the new messages in order, system messages only: a `context_spec` part that unmarshals replaces the spec; a `window` part that unmarshals sets the window when both bounds are non-empty and clears it otherwise; a message that changed either is resolved under the accumulated pair and, on success, gains a `pinned_ids` part carrying the result. A resolution error leaves the message without a receipt, silently, and the message is persisted that way — the hydrator then emits no delta for it. Parts that fail to unmarshal are ignored. The refinement-create handler seeds the same three parts when it seeds a spec (`refinement.md` § 2); the token estimate's conversation form fabricates such a message without persisting it (§ 6).

`LatestPinnedAndSpec(msgs)` reads a transcript's current state: scanning newest to oldest over system messages, it takes independently the newest `pinned_ids`, `context_spec` and `window` part that unmarshals (a part that fails to parse is skipped and the scan continues to older ones). A `window` part with an empty bound counts as found and yields a nil window. Absent parts yield an empty receipt, an empty spec, and a nil window.

**Diffs.** `PinnedIDs.Diff(other)` = ids in the receiver not in `other` (one-directional; used by staleness: `current.Diff(recorded)`, where a windowed reflection considers only `fragmentIds` and the windowless verdict considers both lists — `rotation.md` § 2, § 2.1). `DiffPinnedIDs(old, new)` returns both `added` (new − old) and `removed` (old − new), each in its source order (used by transcript hydration and by `SnapshotIsCurrent`, which treats a snapshot as current only when both are empty). Both compare `fragmentIds` and `snapshotIds` as opaque strings and **ignore `expandedIds`**; `IsEmpty` likewise ignores it.

## 6. Prompt-size guard

`engine.EstimateTokens(chars)` = `chars / 4` (bytes, integer division). `engine.PromptBudget(model)` = `window − window/8`, where `window` = `llm.SelectedProvider(model).ContextWindow()`; `0` when the provider reports `≤ 0`. `engine.CheckPromptFits(model, chars)`: a provider reporting `≤ 0` is never checked (returns nil); otherwise refuses when the estimate exceeds the budget with `&ContextTooLargeError{Model, Estimated, Limit}` — `Limit` is the **full window**, not the budget — whose message is `the context is about <n> tokens but <model> accepts about <m> — narrow the window or the context` (numbers as `%.1fM` from 1,000,000, `<n>k` from 1,000, else plain) and which unwraps to `ErrContextTooLarge` (`context too large for the model`). `engine.MessagesChars(msgs)` sums the byte length of every message's `Content`.

`ContextWindow()` is a constant per provider (`models.md` § 6): Gemini 1,000,000; Ollama 256,000 (the live `num_ctx` probe is not used here); the error provider returned for an unconfigured model reports 0, so such a prompt is unchecked and fails at the call instead.

The seven `CheckPromptFits` call sites, with what each does on refusal, followed by the two token-estimate forms, which reuse `EstimateTokens` and `PromptBudget` but never call the guard:

| Site | Measured text | On `ContextTooLargeError` |
|---|---|---|
| Chat turn (`HandleChat`) | the hydrated transcript incl. system prompt | `422` with the message; when the mode is not summaries, the hint ` Switch the scope to "Summaries" in the context bar to chat over it through summaries instead.` is appended (`chat.md` § 3) |
| Summaries-mode tool rounds (`streamSummariesTurn`) | the transcript plus each round's echo and results | an SSE `error` event with the message; the turn stops (`chat.md` § 5) |
| Refinement turn (`HandleChatForRefinement`) | the hydrated transcript incl. system prompt | `422` with the message (`refinement.md` § 3) |
| Refinement name-only continuation | the transcript plus the echo and continue line | logged; no continuation text (`refinement.md` § 3) |
| Apply leg (`engine.ApplyDraftLens`) | the assembled apply prompt | a `refine_error` part/event with `kind: "context_too_large"` and the message (`refinement.md` § 3.1) |
| Snapshot generation (`engine.GenerateOutput`) | the assembled apply prompt | the generation fails; the interactive generate routes map `ErrContextTooLarge` to `422` (`lifecycle-projection.md` § 4.2, `lifecycle-reflection.md` § 5.2); in the wave the failure ends the wave (`rotation.md` § 3) |
| Chat brief (`chat.GenerateBrief`) | the brief system prompt plus the transcript lines | `422` from the brief route (`chat.md` § 2) |
| Token estimate, spec form (`POST /api/context/tokens`) | see below | reports `limit` and `fits`, never refuses |
| Token estimate, conversation form | see below | likewise |

The same `chars / 4` estimate backs `POST /api/context/tokens` (`api.md` § 3). **Spec form** (no `conversationId`): each selector is resolved and rendered on its own with `HydrateDeltaToText` as a fresh context in the spec's mode (summaries rows only when `wholeScope == "summaries"`); `WholeScope` is counted once when set; fragment-level pins (`Fragment:<id>`, `Type:<t>`, `Colour:<id>`) are counted only when `wholeScope` is empty or `"summaries"`; snapshot pins (`Projection:<id>`, `Reflection:<id>`) always; a window with a missing bound is dropped; a resolution error counts as 0. `model` and `limit` = the chat role's **default** model (`ResolveRoleFor(RoleChat, "")`) and its `PromptBudget` (both absent when resolution fails), `fits` = `limit ≤ 0 || total ≤ limit`. **Conversation form** (`chat.EstimatePrompt`): the persisted transcript (or none, for a conversation that has not sent yet) plus one unpersisted system message carrying the request's spec fields as a `context_spec` part and, when a window was sent, a `window` part, resolved as a turn would be (§ 5), is assembled with `PrepareLLMPrompt`; message 0 is counted as `System`, other system messages as `Context`, the rest as `Transcript`; `limit` is the budget of the conversation's `generate_with_model` override resolved against the chat role, so this form does honour the override; an estimate error → `500 estimate failed`.

## 7. Mentions and flattening

`Flatten(uiMessages)` turns a persisted UI transcript into model messages, one UI message at a time:

- a message carrying a `data-window_reapply` part (`WindowReapplyPartType`) is dropped entirely (`refinement.md` § 4);
- `text` parts are appended after `ExpandMentions`;
- `tool-read_fragment` / `tool-read_thing` parts whose data has a non-empty `output` are collected (tool name from `toolName`, else the part type without `tool-`); at the next `text` part or the end of the message the pending reads flush as **two** messages — one in the UI message's role holding the text so far plus `\n\n[You called: <names>]`, and a `user` message holding the outputs joined by a blank line — and the text buffer restarts (`chat.md` § 5). A read part without `output` (an interrupted call) is invisible;
- a `tool-update_lens` part with a non-empty `input.lens` is echoed as `[You called <toolName>, setting the lens to:]\n<lens>`, separated from preceding text by a blank line — the **only** tool part echoed;
- every other part type (`tool-apply_result`, `tool-suggest_name`, `data-*`, unknown tools) is invisible to the model.

A message that yields no text and no reads produces nothing.

`ExpandMentions` rewrites the client's wire token `@[Kind:id|Label]` (Kind ∈ Fragment, Projection, Reflection, Colour, Type; id 1–32 chars of `[A-Za-z0-9_-]`; label 0–80 chars without `]`, CR or LF; an empty label falls back to the id) into the prompt forms in `prompts.md` § 1: `@"<label>" (Fragment ID: <id>)`, `@"<label>" (Projection: <id>)`, `@"<label>" (Reflection: <id>)`, `@"<label>" (Colour — its tagged fragments are in the context)`, and for Type `@"<id>" (fragment type — those fragments are in the context)` (the label is not used). Anything not matching passes through as literal text. The raw token is what persists; expansion happens only at prompt assembly, and only through `Flatten`. Mentions do **not** change resolution — the client is expected to have added the item to the spec.

`StripMentions` rewrites the same token to `@<label>` (label falling back to the id) for text kept as content rather than sent to the model: the bookmark-save path applies it to user turns before they become fragments (`chat.md` § 2).
