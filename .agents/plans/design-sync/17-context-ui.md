# 17 — New-feature surface (context UI · markdown · inline naming)

Scope: everything that landed on main **after** this sweep started and so was
never in a screen step: the context-bar/mentions UI (#53–#56), markdown
rendering of LLM output (#59 "vibedown"), and inline entity naming (#62).

The mechanical §-compliance work is already done (2026-08-18): the pickers
and pin chips wear the route's section accent; `MarkdownContent` speaks §2
roles in both variants; mention chips are square; the mention menu is
shadowless; the quota notice is drifting-toned (closing step 05's old open
item); and DESIGN.md documents the generated-content type table (§2) and the
inline-rename recipe (§7).

## What remains: Sara's review

This step is review-led, like 14. Walk the surfaces below; any adjustment
goes through the README loop (comply / rule change / recorded exception).

1. **Picker + pin tints** — her abolish-yellow work was re-applied onto
   components she has never seen rendered. Open the context bar's three
   pickers and add/remove a pin on: **Chat** (yellow), **NewProjection** and
   **ProjectionReview** (green), **NewReflection** (violet).
2. **Markdown rendering** — both variants: chat bubbles (incl. an @-mention
   chip inside a message), projection draft preview, snapshot preview, the
   snapshot **compare pane's ins/del diff voice** (stable/critical washes),
   reflection body, rotation card. Headings, lists, code, tables per the §2
   generated-content table.
3. **Inline-renameable titles** — hover pencil + section-accent editing
   underline, on NewProjection, NewReflection, ProjectionDetail and the
   reflection header. Note: the ProjectionDetail and reflection headers
   belong to already-ticked screens 09/10 — #62 changed them after her tick,
   so this is also their re-review.

Compile check: `npx tsc --noEmit` in `app/`. Then tick the step in
`00-INDEX.md`.
