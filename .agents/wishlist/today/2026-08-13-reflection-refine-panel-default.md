---
title: "Reflections page shows Refine panel by default instead of defaulting to view mode"
status: "open"
author: "human"
created: "2026-08-13"
expanded: "2026-08-14"
---

## Description
When selecting a reflection on the Reflections page, the "Refine" side panel (containing context picker, schedule config, and refine chat) is currently rendered by default. The page must open in a clean "View mode" by default, with an explicit toggle button in the header to enter/open "Refine mode".

## Steps to Reproduce
1. Navigate to the Reflections page (`/reflections`).
2. Select an existing reflection from the left sidebar list.
3. Observe that the Refine panel is active and visible immediately on the right side of the main body.

## Observed Behavior
The Refine side panel (`w-[340px]`) is always visible by default for all live selected reflections, cluttering the view when users only want to read or inspect the reflection.

## Desired Working End State

1. **Default View Mode**:
   - When a user selects a reflection or navigates between reflections on the Reflections page, the detail view defaults to clean **View mode**.
   - The middle Refine panel (`w-[340px]` column) is collapsed/hidden by default.
   - The detail view displays only `ReflectionHeader`, `ReflectionBody` (content), and the right-hand timeline sidebar (`RefreshCard`, `SchedulePill`, `SummaryLog`).

2. **Header Action & Toggle State**:
   - A `"Refine"` action button is rendered in `ReflectionHeader` on the top-right (adjacent to the `latest` status pill for live reflections).
   - Clicking `"Refine"` opens/expands the Refine side panel (containing context picker, schedule controls, and chat panel/composer).
   - When the Refine panel is expanded, the header button visually reflects the active state or serves as a collapse trigger.

3. **Per-Selection Default**:
   - Selecting a different reflection in the left sidebar resets the panel state back to View mode (Refine panel closed) for the newly selected reflection.

4. **In-Memory Draft Retention**:
   - Toggling the Refine panel closed without committing does not destroy active refine session drafts. Re-opening the Refine panel for that reflection restores the active session draft/chat intact.

5. **Read-Only Snapshot Behavior**:
   - When viewing a historical read-only snapshot (`/reflections/:id/snapshot/:snapshotId`), the `"Refine"` button in `ReflectionHeader` is rendered as disabled, accompanied by a tooltip explaining that refinement is only available on live reflections (e.g., *"Cannot refine historical snapshots"*).

## Verified Technical Constraints
- `ReflectionDetailPanel` manages the main reflection view layout and hosts `useRefineSession`.
- `ReflectionHeader` receives properties from `ReflectionDetailPanel` and can house the toggle action and tooltips via `@/components/ui/tooltip`.
- Refine panel visibility can be controlled with local state in `ReflectionDetailPanel`.
- No changes required to backend API or database schema.

## Acceptance Criteria
- [ ] Selecting any live reflection defaults to View mode with the Refine panel hidden.
- [ ] A "Refine" button appears in `ReflectionHeader` when inspecting a live reflection.
- [ ] Clicking "Refine" expands the Refine panel (`RefineConfigPanel` + `RefineChatPanel`).
- [ ] Clicking "Refine" again or closing it collapses the panel cleanly.
- [ ] Switching between reflections in the left sidebar always defaults the newly selected reflection back to View mode (Refine panel closed).
- [ ] Closing the Refine panel while mid-draft preserves the refine session state when re-opened.
- [ ] Viewing a historical snapshot displays the "Refine" button as disabled with an explanatory tooltip (`"Cannot refine historical snapshots"`).
