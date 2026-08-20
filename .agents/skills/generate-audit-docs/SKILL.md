---
name: generate-audit-docs
description: Generates or regenerates the kalaidoscope audit snapshot docs (kalaidoscope/docs/*.md) from source code, preserving the series' purpose (auditable description of actual behaviour), its stable formats, and the regeneration regime defined in kalaidoscope/AGENTS.md. Encodes process and conventions only — never code facts.
---

# Skill: Generate Audit Docs

Use this skill when asked to generate or regenerate any audit snapshot in `kalaidoscope/docs/`, or to add a new doc to that series. These docs exist so a human can audit the system's intended functionality without reading the code; they are produced by agents, reviewed by the human, and corrected only through code changes followed by regeneration.

## Core Directives

1. **Purely descriptive**: Document the code exactly as it is. No spec comparisons, no divergence flags, no recommendations, no design commentary in the doc. Behaviours worth the auditor's attention (silent failures, one-way checks, missing surfaces) are pointed out in *chat* while writing — never in the doc.
2. **Wholesale from source**: A generation reads the current code and rewrites the entire file. Never reuse the previous generation's content — only its section skeleton. Never patch a doc incrementally, and never "fix" one outside a requested regeneration.
3. **Structure-stable**: Preserve the existing doc's section skeleton (numbering, table shapes, header block) so successive generations diff cleanly. For a new doc, design a skeleton meant to survive many regenerations.
4. **Ground every claim**: State a behaviour only after reading the code that implements it in this generation — handlers, the engine/worker code they call, hook bodies. Wire and field names come from struct tags and the *actually bound* request structs (handlers may bind anonymous structs that differ from declared DTOs; the bound fields are the contract). Nothing comes from memory, prior docs, or exploration summaries.
5. **Harvest hand edits first**: The human requests design changes by editing these docs. Before regenerating, diff-read the current file: if it contains hand edits (anything a prior generation would not have produced), report them to the user as pending design requests and stop for direction — regenerating over them destroys them silently.
6. **Verify mechanically**: Enumerable facts (route registrations, hooks, collections, files) are re-derived by searching the source at generation time, then cross-checked against the finished doc — every hit must appear, and stated counts must match the fresh search, not any earlier one. Each doc's header states its completeness anchor so the audit can re-run the same check.
7. **Respect the regime**: `kalaidoscope/AGENTS.md` governs these files. Regeneration is human-initiated only. It removes the stale marker, refreshes the `Generated:` date and source commit, and touches nothing else about the file's contract.

## The doc series

| Doc | Covers | Primary source roots |
|---|---|---|
| `api.md` | Custom HTTP routes, hook-modified collection endpoints, auth posture, wire/error conventions | Route-registration sites; `internal/handlers/`; `internal/api/`; hook registrations |
| `schema.md` | Collections, fields, indexes, access rules, stored-JSON shapes, cascades, migration mechanics | `migrations/`; boot-time schema assertions |
| `lifecycle-projection.md` | Projection-specific lifecycle | `internal/handlers/`; `internal/engine/` |
| `lifecycle-reflection.md` | Reflection-specific lifecycle | `internal/handlers/`; `internal/engine/` |
| `lens-distillation.md` | Shared lens machinery: intent timeline, distillation loop, worker, model aliasing | `internal/engine/`; model-role resolution in `llm/` |
| `rotation.md` | Shared freshness machinery: staleness evaluation, reconcile waves | `internal/status/`; `internal/reconcile/` |
| `windows.md` | Reflection window calculation: spec versioning, tiling, identity | `internal/engine/` window/spec code |
| `ingestion.md` | Entry paths, parsers, writer, fragment birth hooks, colour tagging | `internal/ingest/` (+ parsers); `internal/colour/`; fragment hook registrations |

Shared, entity-agnostic machinery gets its own doc; the lifecycle docs stay per-entity and point to it, and a per-entity asymmetry inside a shared mechanism is stated once, in the shared doc. Source roots above are discovery seeds, not boundaries — follow the code wherever it goes.

## Format conventions

- **Header block**, identical shape in every doc:

  ```markdown
  # <Title> — Generated Audit Snapshot

  > **Generated:** <YYYY-MM-DD>, from source at commit `<short-hash>`.
  > This file is a generated audit snapshot — do not edit it. See `AGENTS.md` § "Generated audit docs". When code described here changes, a stale marker line is prepended above this block; nothing else in the file is ever modified by hand.

  **Scope.** <one paragraph: what this doc covers and which sibling docs hold adjacent detail>

  **Completeness anchor.** <where enumerable: the re-checkable claim, e.g. "N routes registered at exactly these sites">
  ```

- **Section shapes**: endpoint docs use tables with columns `Endpoint | Request | Behaviour & side effects | Response / errors`; the schema doc uses per-collection field tables (`Field | Type | Notes`) plus index and rule notes; lifecycle/mechanism docs use short numbered prose sections with small tables only for genuinely tabular facts (e.g. status-at-birth by path).
- **Precision register**: behavioural statements name exact statuses, field names, and rejection conditions ("rejects `400` when X", "sets `<field>` to now", "silently ignored"). Silence, no-ops, and accepted-but-unused inputs are stated explicitly — absences are audit findings too.
- **Cross-references**: `` `other-doc.md` § N ``. Referenced docs must exist.
- **Naming**: category-first filenames (`lifecycle-<entity>`); no entity suffix when only one entity has the concept; mechanism names use the codebase's own vocabulary (the collection/route/package names), not invented synonyms.

## Workflow

### 1. Scope
Map the request to docs via the series table. A code-area request ("the engine changed") may touch several docs; confirm the set with the user if ambiguous.

### 2. Harvest
Read each target doc as it stands. Note a stale marker (expected; it will be removed). If the content contains hand edits, stop and report them as pending design requests (Core Directive 5).

### 3. Read source
Search out the enumerable anchors first (registrations, definitions), then read every implementation the doc will make claims about. Do not write ahead of what has been read this pass.

### 4. Write
Rewrite the file completely: fresh header (today's date, current commit), stale marker gone, skeleton preserved, every claim grounded per Core Directive 4.

### 5. Verify
Re-run the anchor searches and check every hit appears in the doc and counts match. Confirm no placeholder/stub text remains, all cross-referenced docs exist, and the series table in `kalaidoscope/AGENTS.md` matches the actual contents of `docs/` (update it when adding a doc).

### 6. Deliver
Send the finished file(s) to the user. New or large docs go in reviewable slices (pause after the first slice for format/altitude feedback); regenerations of an existing doc go whole. Audit-notable behaviours are summarized in chat, never written into the doc.

## Non-content rule

This skill encodes purpose, format, and process only. It must never contain route paths, counts, collection or field names, or behaviour claims — those live in the docs and are re-derived from source every generation. If such facts are found in this file, that is a defect in the skill: remove them.
