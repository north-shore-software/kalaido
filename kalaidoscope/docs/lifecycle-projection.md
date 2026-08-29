> **STALE** — code has changed since this document was generated.

# Projection Lifecycle — Generated Audit Snapshot

> **Generated:** 2026-08-18, from source at commit `f272f1c`.
> This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

**Scope.** The life of one projection: creation, authoring, generation, approval, and deletion. Shared machinery lives in its own docs — lens compilation in `lens-distillation.md`, staleness and waves in `rotation.md`; endpoint detail in `api.md`, fields in `schema.md`.

---

## 1. Objects and states

A projection is a record holding a name, an optional per-entity `model` override, a `current_context_spec` (what its staleness is judged against), and a `current_lens_id` (the prompt its generations execute). Its output history is an append-only series of `projection_snapshot` rows. A snapshot has exactly two statuses, `"pending"` and `"approved"`; nothing is ever retired, replaced, or deleted by the lifecycle. The **active** snapshot is a derivation, not a flag: the approved snapshot with the highest `approval_sequence_number` (enforced unique per projection by a partial index). Lenses are immutable rows with `parent_lens_id` lineage; old ones are never removed.

## 2. Creation

A projection is created bare: a name and nothing else — no context spec, no lens, no snapshot, no model override. In rotation terms it is a *draft*: never reported stale, never blocking dependents (`rotation.md` § 2).

## 3. Authoring: refinement → commit

The only path by which a projection gains output, a context spec, or a lens is a **refinement session** (`refine_proj_snapshot_conversation`):

1. A session opens scoped to the projection, optionally to one of its snapshots, optionally seeded with an explicit context spec and/or a pre-written draft (recorded exactly as if the model had drafted it).
2. Chat turns stream against the refinement system prompt with the `update_draft` / `suggest_name` tools; the transcript accumulates drafts and context states (`pinned_ids` deltas).
3. **Commit** turns the latest draft into a new snapshot that is approved and sequenced immediately — committed text goes live with no separate approval step. The snapshot records the transcript's context spec and resolved context as its receipt.
4. With `updateLensAndContext: false`, the new snapshot keeps the source snapshot's lens; the projection's own `current_context_spec` and `current_lens_id` are untouched.
5. With `updateLensAndContext: true`: the projection's `current_context_spec` is overwritten with the transcript's spec, and the snapshot is written as a distillation request (`lens-distillation.md` § 2). Until the compiled lens lands, the previous lens keeps serving generations.

## 4. Generation and approval

Generation (manual candidate request, or a reconcile wave per `rotation.md` § 3) executes the **current lens**: the lens supplies both the prompt and the context spec that gets resolved and hydrated. Note the asymmetry: *generation consumes the lens's spec; staleness evaluates the projection's `current_context_spec`*. The two are written together by an updating commit and by distillation, so they normally agree, but nothing else keeps them in sync. A projection with no lens (or an empty lens prompt) generates an empty snapshot without an LLM call.

Every generation appends a snapshot carrying its receipt (`resolved_context`), the generating model, and `generation_timestamp`. Status at birth:

| Path | Snapshot status |
|---|---|
| Manual generation, `preview: true` | `pending` — a candidate awaiting approval |
| Manual generation, `preview` absent/false | `approved` immediately, sequenced in the same request |
| Reconcile wave | `pending`, chain-marked |
| Refinement commit | `approved` immediately |

Generation is refused (`409`) while an upstream dependency is not itself up to date — a candidate frozen against soon-to-be-superseded input could never settle the projection.

**Approval promotes in place**: the same record gains the next `approval_sequence_number` (max among approved + 1) and `approval_timestamp`; the id never changes, which is what lets wave-generated dependents settle on approval (`rotation.md` § 3). Approval is idempotent, does not verify the snapshot belongs to the projection in the URL, and applies to any snapshot regardless of prior status. Pending candidates that are never approved simply accumulate; nothing retires them.

## 5. Model resolution

Every LLM call resolves its model at call time: a non-empty per-entity `model` override wins outright; otherwise the workspace config's per-role/default models (when a provider is configured), else the env-seeded model set. Changing the override (PATCH) requests a lens-drift pass (`lens-distillation.md` § 6); the override also governs refinement chat and commit provenance, and applies identically to the distill and snapshot roles (`lens-distillation.md` § 7).

## 6. Deletion

Deletion is an unconditional hard delete with no downstream check. Cascades remove the projection's snapshots and refinement conversations (and their messages). Lenses survive with dangling provenance. Downstream consumers whose context spec still names the deleted projection are not touched: the spec entry simply resolves to nothing from then on (and, the staleness diff being one-way, never flags them stale).
