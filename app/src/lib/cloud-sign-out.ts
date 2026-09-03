import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { deleteSetting, getSetting, setSetting } from "@/api/app/settings.ts";
import { authClient } from "@/api/cloud/auth.ts";
import { setAvailableKalaidoscopes } from "@/hooks/app-state-actions.ts";
import { appState } from "@/hooks/use-app-state.ts";

/**
 * Signs out of Kalaido Cloud and returns the app to a genuinely signed-out
 * state.
 *
 * `authClient.signOut()` alone clears the session token and nothing else, so
 * the previous account's cloud workspaces survive in app state AND in the
 * persisted `availableKalaidoscopes` setting — the next screen would list
 * workspaces the signed-out user can no longer open. Dropping them before the
 * reload is what makes "sign out" mean "as if you were never logged in".
 *
 * Local workspaces are deliberately kept: they belong to the device, not the
 * account.
 */
export async function signOutOfCloud(): Promise<void> {
  await authClient.signOut();

  const cloudIds = new Set(
    appState.availableKalaidoscopes
      .filter((k) => k.type === "cloud")
      .map((k) => k.id),
  );
  const localOnly = appState.availableKalaidoscopes.filter(
    (k) => k.type !== "cloud",
  );
  setAvailableKalaidoscopes(localOnly);

  const persisted = await setSetting("availableKalaidoscopes", localOnly);
  if (persisted.isErr()) {
    // The reload re-reads the store, so a failure here would resurrect the old
    // list. Worth a log, but not worth blocking the sign-out.
    console.error(
      "Sign out: failed to persist workspace list:",
      persisted.error,
    );
  }

  await forgetLastOpenedIfCloud(cloudIds);

  reloadAppWindow();
}

/**
 * `lastOpenedKalaidoscopeId` is persisted separately from the workspace list,
 * so signing out while inside a cloud workspace leaves boot pointing at a
 * workspace that no longer exists in the list: `loadStoredState` would ask for
 * `kalaidoscope_load_requested` on a dead id and land the user on a load error
 * instead of the onboarding landing page.
 *
 * Clearing it lets boot fall through to `no_kalaidoscopes_available`, which
 * renders the landing screen with whatever local workspaces remain. No local
 * workspace is auto-opened in its place — which one the user wants is a guess,
 * and the landing page already asks them.
 */
async function forgetLastOpenedIfCloud(cloudIds: Set<string>): Promise<void> {
  const lastOpened = await getSetting("lastOpenedKalaidoscopeId");
  if (lastOpened.isErr()) {
    console.error(
      "Sign out: failed to read last-opened workspace:",
      lastOpened.error,
    );
    return;
  }
  if (!lastOpened.value || !cloudIds.has(lastOpened.value)) return;

  const cleared = await deleteSetting("lastOpenedKalaidoscopeId");
  if (cleared.isErr()) {
    console.error(
      "Sign out: failed to clear last-opened workspace:",
      cleared.error,
    );
  }
}
