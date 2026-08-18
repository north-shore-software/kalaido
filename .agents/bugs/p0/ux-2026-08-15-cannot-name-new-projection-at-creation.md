---
title: "Specify projection name at creation and rename existing projections inline"
status: "specified"
author: "human"
created: "2026-08-15"
updated: "2026-08-17"
---

## Summary
Users cannot explicitly specify a name when creating a new projection, and cannot rename a projection once created (either during the draft phase or after approving).

## Problem Statement & Context
1. **Creation Name Derivation**:
   - When creating a new projection (`NewProjection.tsx`), there is no input field for a name. The system automatically derives the name by taking a raw character slice (`slice(0, 60)`) of the initial prompt.
   - Long or conversational prompts lead to unwieldy default names.
2. **No Rename Capability During Draft**:
   - While authoring and refining in `ProjectionDraftEditor`, the title is static and cannot be edited.
3. **No Rename Capability on Projection Detail**:
   - On the `ProjectionDetail` page, the title displayed in `PageHeader` is read-only.
   - Users have no UI mechanism to rename an existing projection after creation, even though the backend already supports `PATCH /api/projections/:id` with `{ name }`.

## Verified Technical Constraints
- **Backend API**:
  - `POST /api/projections` accepts `{ name: string }` and creates the projection container with the given name (`kalaidoscope/internal/handlers/synthesis.go`).
  - `PATCH /api/projections/:id` accepts `{ name?: string }` and updates the record (`kalaidoscope/internal/handlers/synthesis.go`).
- **Client API**:
  - `createProjection(name: string)` and `updateProjection(projectionId: string, { name?: string })` already exist in `app/src/api/kalaidoscope/projections.ts`.
- **Live Data**:
  - `useProjectionSnapshot` and `useLiveCollection('projection')` reactively update when PocketBase records change.

## Desired Working End State

### 1. Optional Name Input at Creation (`NewProjection.tsx` / `RefineComposer`)
- An optional "Name" input field is available in the projection creation view before initiating generation.
- **Explicit Name**: If the user enters a name, `createProjection` uses the entered name.
- **Fallback Name**: If left empty, the name is derived from the initial prompt:
  - If the prompt has 6 words or fewer, use the full prompt text (trimmed).
  - If the prompt has more than 6 words, shorten to the first 6 words followed by an ellipsis (`…`).
  - If the prompt is whitespace/empty, fallback to `"Untitled projection"`.

### 2. Inline Name Editing During Draft Phase (`ProjectionDraftEditor.tsx`)
- In `ProjectionDraftEditor`, the header title is editable inline (e.g. clicking or focusing the title converts it into an editable field, or an inline input/edit control).
- Saving the edited title (on `Enter` or `blur`) calls `updateProjection(projectionId, { name })` and updates the header immediately.

### 3. Inline Name Editing on Projection Detail (`ProjectionDetail.tsx`)
- In `ProjectionDetail`, the title in `PageHeader` is editable inline in live view (`!readOnly`).
- Clicking the title or an edit affordance allows the user to edit the projection name.
- Submitting the edit (on `Enter` or `blur` with non-empty text) calls `updateProjection(id, { name })` and updates the projection name.
- Pressing `Escape` cancels editing and reverts to the current name without saving.
- Historical snapshots view (`readOnly`) remains read-only.

## Edge Cases & Scope
- **Empty / Whitespace Edit**: Submitting an empty or whitespace-only name should either revert to the previous name or use the fallback `"Untitled projection"`.
- **Seeded Projections**: Projections created from seeds (e.g., forked projections or graduated fragments) already provide a seeded name (`seed.name`); the user can still edit it inline once the draft editor mounts.
- **Scope Limit**: Renaming reflections or other entities is out of scope for this item (focused on projections).

## Acceptance Criteria
- [ ] In `NewProjection`, users can optionally input a custom name before submitting the initial prompt.
- [ ] If no custom name is provided, prompt-derived names longer than 6 words are shortened to the first 6 words with an ellipsis.
- [ ] During refinement in `ProjectionDraftEditor`, users can edit and save the projection name inline from the header.
- [ ] On `ProjectionDetail`, users can edit and save the projection name inline from the header in live view.
- [ ] Pressing `Enter` or clicking outside commits the rename via `updateProjection`.
- [ ] Pressing `Escape` cancels editing without saving.
- [ ] Editing name is disabled in read-only / historical snapshot views.
