---
title: "Startup state machine produces unrecoverable locked states"
status: "specified"
author: "human"
created: "2026-08-13"
expanded: "2026-08-14"
---

## Description
The startup state machine (`use-app-state.ts` / `AppStage`) can transition into terminal error states (`bootstrap_error`, `kalaidoscope_load_error`, `no_kalaidoscopes_available`) with no recovery controls, or hit an unhandled routing exception (`throw "wtf"` in `KalaidoscopeContainer`) with no Error Boundary anywhere in the app to catch it. When this happens, the user is left on a dead screen with no way back in short of restarting the app (and possibly not even then).

## Steps to Reproduce
1. Force or encounter a startup failure (e.g., bad/orphaned scope reference in settings, missing backend sidecar, a component render error).
2. Launch or navigate the application.
3. Observe a dead-end error screen with no buttons, or a blank/frozen screen from an unhandled exception.

## Observed Behavior
- `BootError.tsx` renders static text only — zero buttons/actions (`bootErrorTransitions` is an empty object).
- No `ErrorBoundary` exists anywhere in the app; any uncaught render exception (including the `throw "wtf"` in `KalaidoscopeContainer`) produces a blank/frozen screen.
- The user has no in-app path back to a working state.

## Desired Working End State

1. **Error recovery screens** (`bootstrap_error`, `kalaidoscope_load_error`):
   - Render a friendly, plain-language explanation of what went wrong.
   - Include a collapsed/secondary "Copy error details" action exposing the raw error message/stack — not shown by default.
   - Show explicit recovery actions, varying by stage:
     - **`bootstrap_error`** (settings file itself failed to load — no scope list available): **Retry** (re-attempt loading settings/bootstrap) and **Reset App Settings** (full wipe via existing `resetAppSettings()`, returns to onboarding/scope-selection).
     - **`kalaidoscope_load_error`** (settings loaded fine; one specific scope failed to start): **Retry** (re-attempt starting that same scope), **Switch Kalaidoscope** (pick a different available scope, reusing the switch logic behind `NavKalaidoscopeSwitcher`, presented standalone on this screen), and **Reset App Settings**.
   - Data corruption in a scope's own on-disk store (`pb_data`) is explicitly **out of scope** for this bug — Reset App Settings only clears the app-level settings pointer, never per-scope data directories. Repair tooling for corrupted scope data is a separate future item.

2. **First-run / empty state (`no_kalaidoscopes_available`)**:
   - Dedicated onboarding/welcome page with a single primary action: **"Create your first Kalaidoscope."**
   - No "Reset App Settings" button here — this is a legitimate empty state, not an error.

3. **Root-level Error Boundary**:
   - A single Error Boundary wraps the entire app at the root, catching any uncaught render or routing exception anywhere — including crashes inside the error/recovery screens themselves.
   - Its fallback screen offers the same recovery pattern: friendly message + copyable details, **Retry**, **Switch Kalaidoscope** (if a scope list is available from the last-known settings snapshot), and **Reset App Settings**.
   - This boundary is the sole fix for the `throw "wtf"` race in `KalaidoscopeContainer` — no separate graceful-redirect logic is added for that specific case; the throw may be converted to a typed `Error` for clarity, but is otherwise left to the boundary to catch.

## Verified Technical Constraints
- `AppStage` values and transitions: `use-app-state.ts:5-21`. `bootstrap_error` set only in `loadStoredState()` (`:41-59`) when `getAllSettings()` fails. `no_kalaidoscopes_available` set at `:53`. `kalaidoscope_load_error` set in `local-kalaidoscope.ts:11` and `:32`.
- `BootError.tsx:10-32` currently renders static text with no actions; `bootErrorRoute` (`:34-41`) has empty `transitions`. Both `bootstrap_error` and `kalaidoscope_load_error` route here (`route-kit.ts:91-92`).
- `KalaidoscopeContainer` (`app-router.tsx:81-105`) throws `"wtf"` at line 84 on a narrow valtio re-render race between `RouteGatekeeper`'s snapshot and the container's own re-render. No `ErrorBoundary` exists in the codebase today (confirmed via repo-wide search).
- `NavKalaidoscopeSwitcher` (`nav-kalaidoscope-switcher.tsx`) is an existing scope-picker dropdown, currently only rendered inside normal app nav chrome — will need a standalone presentation for the error screens, reusing its underlying switch logic (`switchLocalKalaidoscope`).
- `resetAppSettings()` (`app/src/api/app/settings.ts:59-66`) clears the entire `kalaido-settings.json` store (theme, ollama model, pinned projections, action history, scope pointer) — confirmed intentional, kept as-is. It does not touch per-scope data directories on disk (`app-data-dir/kalaidoscopes/<id>/pb_data`), confirmed by existing comment in `DangerZoneSection`.
- No repair/diagnostic/integrity-check tooling exists anywhere in the repo for corrupted per-scope data — confirmed via repo-wide search. Consistent with treating data corruption as out of scope here.

## Out of Scope
- Repairing or diagnosing corrupted per-scope PocketBase data (`pb_data`). Reset App Settings does not and will not address this.
- Any change to what `resetAppSettings()` clears — it remains a full wipe.
- A "Reset App Settings" action on the `no_kalaidoscopes_available` empty state.
- Bespoke graceful-redirect handling for the `throw "wtf"` race specifically — superseded by the root Error Boundary.

## Acceptance Criteria
- [ ] `bootstrap_error` screen shows friendly message + collapsed "Copy error details", and **Retry** + **Reset App Settings** actions only (no Switch Kalaidoscope).
- [ ] `kalaidoscope_load_error` screen shows friendly message + collapsed "Copy error details", and **Retry** + **Switch Kalaidoscope** + **Reset App Settings** actions.
- [ ] "Retry" on `bootstrap_error` re-attempts the settings/bootstrap load; "Retry" on `kalaidoscope_load_error` re-attempts starting the same scope.
- [ ] "Switch Kalaidoscope" presents the existing scope-switcher logic standalone on the error screen and successfully switches to a different available scope.
- [ ] "Reset App Settings" clears the full settings store and returns the user to onboarding/scope-selection.
- [ ] `no_kalaidoscopes_available` shows only "Create your first Kalaidoscope" — no Reset App Settings button.
- [ ] A root-level Error Boundary catches any uncaught render/routing exception app-wide (including within the error screens) and renders the same friendly-message + Retry/Switch/Reset recovery pattern.
- [ ] The `throw "wtf"` race in `KalaidoscopeContainer`, when hit, is caught by the root Error Boundary rather than producing a blank/frozen screen.
