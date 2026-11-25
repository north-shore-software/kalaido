import { signOutCloudAuth } from "@kalaido/client/cloud/auth";
import { resetPostHog } from "@kalaido/client/lib/posthog";
import { clearCloudLiveCache } from "@kalaido/hooks/kalaidoscope-live";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import {
  desktopScope,
  detachDesktopPushBridges,
  teardownActiveClient,
} from "@/state/app-state.ts";

/**
 * Signs out of Kalaido Cloud and returns the app to a genuinely signed-out
 * state while preserving local workspaces on this device.
 */
export async function signOutOfCloud(): Promise<void> {
  resetPostHog();
  await signOutCloudAuth();

  const { appStage, cachedCloudKalaidoscopes } = desktopScope.state;
  const activeIsCloud =
    appStage.stage === "kalaidoscope_open" &&
    cachedCloudKalaidoscopes.some(
      (k) => k.id === appStage.selectedKalaidoscopeId,
    );

  if (activeIsCloud) {
    await teardownActiveClient();
  }
  await clearCloudLiveCache();

  await desktopScope.dispatch({ type: "signOutCloud" });
  await desktopScope.flush();
  detachDesktopPushBridges();
  reloadAppWindow();
}
