---
title: "Composite Bug Report: Sign In / Sign Up Page & Authentication State"
status: "expanded"
author: "human"
created: "2026-08-14"
---

## Description
This composite bug report covers issues identified on the Sign In / Sign Up page and authentication state management:
1. **Redundant UI Controls & Unnecessary Signup Field**: The sign in/up page has a toggle at the top for "sign in" and "sign up", but also includes a redundant link underneath for "sign up". Additionally, the signup form asks for "Name", which is unnecessary (email is sufficient).
2. **Broken Social Logins**: The "Log in with Google" and "Log in with GitHub" buttons on the sign up/in page are not hooked up and do not work.
3. **Incomplete Sign-Out State Cleanup**: Signing out of an account does not remove associated cloud accounts from local app settings or the scope selector dropdown, and fails to unselect the active scope if it was a cloud scope for that account.

---

## Verified Codebase Constraints
* **Auth Client & Session**: Cloud authentication uses Better Auth via `authClient` (`src/api/cloud/auth.ts`). Session tokens are stored in `localStorage` under `kalaido.cloud.session-token`.
* **Auth UI Components**:
  * Onboarding auth panel lives in `src/features/onboarding/components/cloud-auth-panel.tsx` using `<Segmented>` top toggle + `<AuthForm>`.
  * Settings cloud account section lives in `src/features/settings/components/cloud-account-section.tsx`.
  * Form component lives in `src/features/settings/components/auth-form.tsx`.
  * Social login buttons live in `src/features/settings/components/oauth-buttons.tsx`.
* **Scope Storage & State Management**:
  * Scopes/kalaidoscopes are tracked in `appState.availableKalaidoscopes` (Valtio proxy) and persisted in `kalaido-settings.json` via `setSetting("availableKalaidoscopes", ...)`.
  * Open scope stage is held in `appState.appStage` (`kalaidoscope_open`, `selectedKalaidoscopeId`).
* **Browser Launcher**: External system browser is opened via `openSystemBrowser(url)` from `src/api/app/os-integrations.ts` using `@tauri-apps/plugin-opener`.

---

## Target Working End State

### Sub-Issue 1: Sign In / Sign Up Form & UI Alignment
* **Unified Component Reuse**:
  * Settings page (`/settings/cloud-account`) reuses the exact same auth component hierarchy (`CloudAuthPanel` or direct `<Segmented>` + `<AuthForm>` composition) as the Onboarding sign-in screen.
* **Exclusive Top Navigation**:
  * Toggling between "Sign in" and "Sign up" modes is driven strictly by the top `<Segmented>` control.
  * The redundant text button link at the bottom of `<AuthForm>` ("Don't have an account? Sign up" / "Already have an account? Sign in") is permanently removed.
* **Email-Only Signup**:
  * Remove the "Name" `<Input>` field entirely from `<AuthForm>`, Storybook stories, and signup input interfaces.
  * Email and Password are the sole inputs required for account registration.
  * Calls to `authClient.signUp.email` pass `{ email, password }` with `name` omitted or defaulted to empty string.

### Sub-Issue 2: Social Logins (Google & GitHub) Open Specifications
* **Current UI Functionality**:
  * Social login buttons ("Continue with Google", "Continue with GitHub") are rendered via `<OAuthButtons>`.
* **Documented Open Questions & Technical Requirements**:
  1. *Redirect vs JSON URL*: Better Auth `authClient.signIn.social` needs `disableRedirect: true` in desktop/Tauri environments so the server returns `{ data: { url: string } }` without redirecting the webview, enabling the app to open `url` via `openSystemBrowser()`.
  2. *OAuth Callback Protocol in Desktop App*: Define how the desktop app captures the resulting session after external browser authentication completes:
     * *Option A*: Custom deep-linking URL scheme (`kalaido://auth/callback`).
     * *Option B*: Local loopback web server/port listener during OAuth.
     * *Option C*: Background session polling against `authClient.getSession()` while OAuth browser window is active.
  3. *Backend Provider Configuration*: Confirm Google and GitHub OAuth client ID and secret credentials are configured on the deployed Better Auth server environment.

### Sub-Issue 3: Sign-Out State Cleanup & Scope Handling
* **Cloud Workspace Purge**:
  * Signing out via `AccountCard` (`authClient.signOut()`) must purge all `type: "cloud"` workspaces/scopes from `appState.availableKalaidoscopes` and update persistent app settings (`kalaido-settings.json`), as unauthenticated cloud scopes are inaccessible.
* **Active Scope Handling on Sign-Out**:
  * If the user is currently inside a cloud scope when signing out:
    * Upon leaving Settings or re-launching the app, navigate the user to the Onboarding Landing page (`/onboarding/landing` or `no_kalaidoscopes_available` stage).
    * The Onboarding Landing page will render the list of remaining available local scopes (if any exist). If no local scopes remain, the page provides options to create a local scope or sign in.
* **Re-authenticating / Signing Back In**:
  * Signing back in via Onboarding or Settings invokes `listCloudKalaidoscopes()` and automatically populates all owned cloud workspaces back into `appState.availableKalaidoscopes` and the scope switcher dropdown.
* **Documented Alternative Option (Logged-Out Scope Entries)**:
  * *Alternative Design*: Keep cloud scopes in `availableKalaidoscopes` and scope switcher dropdown, visually badged or flagged as `"Logged out"`.
  * Selecting a `"Logged out"` cloud scope triggers a modal or inline prompt guiding the user through a "Log back in" flow before opening the workspace.

---

## Acceptance Criteria
1. **Settings / Onboarding Auth UI**:
   - Toggling between Sign In and Sign Up uses only the top `<Segmented>` control. No bottom toggle link is displayed.
   - Signup form contains only Email and Password fields. No Name field is present.
2. **Sign-Out State Cleanup**:
   - Signing out clears session tokens and removes all cloud scopes from `availableKalaidoscopes` and `kalaido-settings.json`.
   - Signing out while inside a cloud scope routes the user to the Onboarding Landing page upon exiting Settings or on app restart, displaying available local scopes or scope creation prompt.
3. **Re-Authentication**:
   - Signing back in fetches all owned cloud scopes and restores them in the scope switcher dropdown.

---

## Implementation Status (2026-08-14)

**Sub-issues 1 and 3 are done. Sub-issue 2 (OAuth) is deliberately not.**

* `<AuthForm>` lost the Name field and the bottom toggle link; `onToggleMode` was
  removed from its props rather than left dead, so mode is structurally the
  caller's `<Segmented>` control and cannot drift. `signUp.email` sends
  `name: ""`, and the account card and setup identity panel fall back to the
  email — no display name is invented from the address.
* Settings renders the same `<CloudAuthPanel>` as onboarding. It passes no
  `onAuthenticated`: the panel restores the account's workspaces itself, and the
  section swaps to the account card because `authClient.useSession()` is
  reactive. Signing up from Settings never navigates.
* `OAuthButtons` renders both providers disabled with a "Coming soon" badge, and
  no longer calls `authClient.signIn.social` — which failed against a server with
  no providers configured, so the buttons produced a raw backend error. The three
  open questions in sub-issue 2 are unanswered and still gate the work.
* Sign-out purges cloud workspaces from state and settings (the "logged out
  badge" alternative below was considered and rejected), and now also clears
  `lastOpenedKalaidoscopeId` when it names one of them.
* `switchLocalKalaidoscope` now persists `lastOpenedKalaidoscopeId`. It was
  previously written only by `createKalaidoscope`, so the setting meant "last
  *created*" — a pre-existing bug in its own right (switch workspaces, restart,
  return to the wrong one), and the reason sign-out could not otherwise tell
  whether the workspace being reopened was the one it had just made unreachable.
* Re-authentication repopulates the switcher from anywhere via
  `syncCloudWorkspaces()`, which also closed
  `.agents/bugs/2026-08-14-stale-cloud-workspace-list.md`.

## Edge Cases & Scope Limits
* **Offline Sign-Out**: If the device is offline during sign-out, local session tokens and cloud scope entries must still be purged locally from app state and settings.
* **No Remaining Local Scopes**: If a user with zero local scopes signs out of a cloud scope, the app transitions to `no_kalaidoscopes_available` state, rendering the Onboarding Landing screen.
