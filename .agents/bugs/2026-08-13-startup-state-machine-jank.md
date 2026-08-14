---
title: "Startup state machine produces unrecoverable locked states"
status: "open"
author: "human"
created: "2026-08-13"
expanded: "2026-08-14"
---

## Description
The startup state machine (`use-app-state.ts` / `AppStage`) can transition into terminal error states (`bootstrap_error`, `kalaidoscope_load_error`, `no_kalaidoscopes_available`) or execute unhandled route throws (`throw "wtf"` in `KalaidoscopeContainer`). When this happens, navigation and UI interactions break completely, leaving the user trapped without recovery controls.

## Steps to Reproduce
1. Force or encounter a startup failure (e.g., bad database file, missing backend sidecar, corrupt local store).
2. Launch or navigate the application.
3. Observe that the app enters a dead-end error screen or crashes on an unhandled routing exception (`throw "wtf"`).

## Observed Behavior
The application gets stuck in an error stage with no recovery buttons or throws an unhandled routing exception, locking the user out of all pages and recovery actions.

## Desired Working End State

1. **Resilient Error Recovery Screens**:
   - All startup failure and error stages (`bootstrap_error`, `kalaidoscope_load_error`, `boot-error`) render clear diagnostic information along with three explicit, interactive recovery actions:
     1. **Retry / Try Again** (Primary): Re-attempts loading/starting the active Kalaidoscope scope.
     2. **Switch Kalaidoscope** (Secondary): Opens a scope selection interface allowing the user to pick another available scope.
     3. **Reset App Settings** (Fallback/Destructive): Clears stored `lastOpenedKalaidoscopeId` and resets application state so the user can start fresh without losing scope data files.
   - During boot errors, header scope-switching in `TitleBar` is hidden/disabled in favor of these centered recovery buttons on the error page.

2. **First-Run / Empty State (`no_kalaidoscopes_available`)**:
   - When no Kalaidoscopes exist, the app renders a dedicated Onboarding/Welcome page with a prominent `"Create your first Kalaidoscope"` primary action and a secondary `"Reset App Settings"` fallback option.

3. **Graceful Routing & Fail-Safe Error Handling**:
   - Route gatekeeping never throws unhandled string exceptions (e.g. `throw "wtf"`). Missing scopes or invalid stage transitions redirect gracefully to the stage's entry route or render a loading indicator.
   - A top-level Error Boundary catches uncaught rendering or routing exceptions, providing the user with immediate recovery controls (Retry, Switch Scope, Reset Settings) rather than a blank or frozen screen.

## Verified Technical Constraints
- `use-app-state.ts` manages `AppStage` stages (`bootstrap_error`, `kalaidoscope_load_error`, `no_kalaidoscopes_available`, etc.).
- `app-router.tsx` controls `RouteGatekeeper` and `KalaidoscopeContainer`.
- `BootError.tsx` (and associated boot error views) can host the recovery actions (Retry, Switch, Reset Settings).
- Resetting app settings clears `lastOpenedKalaidoscopeId` via existing settings API (`/api/app/settings`).
- No backend database schema changes required.

## Acceptance Criteria
- [ ] Startup failure stages (`bootstrap_error`, `kalaidoscope_load_error`, `boot-error`) display the 3 recovery buttons: Retry, Switch Kalaidoscope, Reset App Settings.
- [ ] Clicking "Retry" re-initiates the scope loading flow.
- [ ] Clicking "Switch Kalaidoscope" presents the scope picker to choose a different scope.
- [ ] Clicking "Reset App Settings" clears `lastOpenedKalaidoscopeId` and returns the state machine to scope selection/onboarding.
- [ ] `no_kalaidoscopes_available` renders an onboarding page with "Create your first Kalaidoscope" and "Reset App Settings".
- [ ] Removing/replacing `throw "wtf"` ensures invalid route transitions do not crash the React component tree.
- [ ] Uncaught errors are caught by an Error Boundary with user recovery options (Retry / Switch Scope / Reset Settings).
