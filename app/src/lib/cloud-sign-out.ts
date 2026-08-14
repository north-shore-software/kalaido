import { setSetting } from "@/api/app/settings.ts";
import { authClient } from "@/api/cloud/auth.ts";
import { setAvailableKalaidoscopes } from "@/hooks/app-state-actions.ts";
import { appState } from "@/hooks/use-app-state.ts";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";

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

  const localOnly = appState.availableKalaidoscopes.filter(
    (k) => k.type !== "cloud",
  );
  setAvailableKalaidoscopes(localOnly);

  const persisted = await setSetting("availableKalaidoscopes", localOnly);
  if (persisted.isErr()) {
    // The reload re-reads the store, so a failure here would resurrect the old
    // list. Worth a log, but not worth blocking the sign-out.
    console.error("Sign out: failed to persist workspace list:", persisted.error);
  }

  reloadAppWindow();
}
