# Agent Instructions — kalaidoscope

These instructions apply to any coding agent (Claude, Codex, Cursor, Copilot, or other) working in this directory tree.

## Generated audit docs (`docs/*.md`)

The files in `docs/` are **generated audit snapshots**. Each one was produced in a single pass by an agent reading the source code, and describes what the code actually did at generation time. They exist so a human can audit the system's behaviour without reading the code. They are **not** hand-maintained documentation.

**Rules — these are strict:**

1. **Never edit the content of a file in `docs/`.** Not to fix an inaccuracy, not to reflect a code change you just made, not to improve wording. The docs are corrected only by full regeneration.

2. **If you change code whose behaviour a doc describes, mark that doc stale.** Prepend exactly this single line at the very top of the affected file, followed by a blank line:

   ```
   > **STALE** — code has changed since this document was generated.
   ```

   Add nothing else — no description of what changed, no date, no second marker. If the line is already present, do nothing.

3. **Regeneration only happens when a human asks for it.** Regenerate by following the `generate-audit-docs` skill (`.agents/skills/generate-audit-docs/SKILL.md` at the repository root), which encodes the series' purpose, formats, and process. In short: to regenerate: read the current source, rewrite the file completely from scratch (never patch it incrementally), remove the stale marker, refresh the `Generated:` date in the header, and preserve the file's established section structure and table format so successive generations diff cleanly.

4. **Docs are purely descriptive.** They state what the code does — never what it should do, no recommendations, no design commentary, no comparisons against specs.

**Why:** these docs are the review surface for the system's design. The human reviews a generation, requests design changes (by editing the doc or in conversation), the *code* is then changed, and the doc is regenerated from the new code. A hand-edited doc in `docs/` is therefore a design request awaiting implementation — treat any human edits you find there as input for code changes, never as content to preserve or merge, and never "correct" the doc back.

## The doc series

The series covers the Go backend binary only. Its authoritative definition (scope and source roots per doc) is the series table in the `generate-audit-docs` skill; this table tracks which files exist.

| File | Covers | Status |
|---|---|---|
| `docs/api.md` | The external HTTP surface: custom routes, hook-modified collection endpoints, auth posture, wire formats, error shapes | generated |
| `docs/schema.md` | The database: collections, fields, indexes, access rules, stored-JSON shapes, cascades | generated |
| `docs/boot-and-workers.md` | Boot order and every background goroutine: triggers, drain/retry semantics, startup sweeps, follow-up queue | generated |
| `docs/lifecycle-projection.md` | Projection-specific lifecycle: creation, authoring, generation claims, approval, deletion | generated |
| `docs/lifecycle-reflection.md` | Reflection-specific lifecycle: schedule, windowed generation, backfill, per-window approval | generated |
| `docs/windows.md` | Reflection window calculation: spec versioning, tiling, window identity, per-window staleness | generated |
| `docs/refinement.md` | The shared refinement conversation: lens drafting, preview leg, commit; lens rows and active-lens resolution | generated |
| `docs/context.md` | Context spec resolution, hydration, pinned receipts and staleness diff, token guard | generated |
| `docs/rotation.md` | Shared freshness machinery: staleness evaluation and reconcile waves | generated |
| `docs/models.md` | Model registry, workspace config and validation, role resolution, local-model surface | generated |
| `docs/llm-queue-quota.md` | LLM call scheduler, usage recording and quota, provider error classification | generated |
| `docs/prompts.md` | Inventory of prompt templates: consuming flow, role, inputs, shared blocks | generated |
| `docs/ingestion.md` | How content becomes fragments: entry paths, parsers, writer, birth hooks and their signals, soft delete | generated |
| `docs/map.md` | The map flow: annotation, aggregate/settle, consolidation, things document, kick route | generated |
| `docs/colours.md` | Colours: membership join and precedence, preview/create seeding, judging worker, thing rematch, scrubbing | generated |
| `docs/discover.md` | The discover flows: runs, tool loop, flow kinds, proposals vs created rows, rhythm detection | generated |
| `docs/chat.md` | The general chat conversation and its summaries mode | generated |
| `docs/organize.md` | The organise pipeline: the derived status behind `GET /api/organize` and the post-import chain | generated |

`docs/lens-distillation.md` is **retired**: the mechanism it described no longer exists in source and its subject is taken over by `docs/refinement.md`. The file has been deleted; do not regenerate it. Any future addition to the series follows the same rules.
