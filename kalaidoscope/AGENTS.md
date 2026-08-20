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

| File | Covers |
|---|---|
| `docs/api.md` | The external HTTP surface: custom routes, hook-modified collection endpoints, auth posture, wire formats, error shapes |
| `docs/schema.md` | The database: collections, fields, indexes, access rules, stored-JSON shapes, cascades |
| `docs/lifecycle-projection.md` | Projection-specific lifecycle: creation, authoring, generation, approval, deletion |
| `docs/lifecycle-reflection.md` | Reflection-specific lifecycle: schedule, windowed generation, per-window approval |
| `docs/lens-distillation.md` | Shared lens machinery: intent timeline, distillation loop, background worker, model aliasing |
| `docs/rotation.md` | Shared freshness machinery: staleness evaluation and reconcile waves |
| `docs/windows.md` | Reflection window calculation: spec versioning, tiling, window identity |
| `docs/ingestion.md` | How content becomes fragments: entry paths, parsers, writer, colour tagging |

All files above exist and are generated; any future addition to the series follows the same rules.
