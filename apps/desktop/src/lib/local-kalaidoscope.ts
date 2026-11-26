import { CloudAuthRequiredError } from "@kalaido/client/kalaidoscope/client";
import { setActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { toError } from "@kalaido/client/lib/errors";
import { err, ok, type Result } from "neverthrow";
import {
  getLocalKalaidoscopeStatus,
  startLocalKalaidoscope,
  stopLocalKalaidoscope,
} from "@/api/app/local-scopes";
import { createKalaidoscopeClient } from "@/api/app/sidecar-client";
import {
  allKalaidoscopes,
  cancelPendingClientOpen,
  clearPendingClientController,
  desktopScope,
  isCurrentClientOpen,
  registerPendingClientController,
  type StageEntry,
  stageError,
  teardownActiveClient,
} from "@/state/app-state.ts";
import {
  openKalaidoscope,
  removeRegisteredKalaidoscope,
  setAppStage,
  setLastOpenedKalaidoscopeId,
  setSidecarStatus,
} from "@/state/app-state-actions.ts";

export interface SwitchOptions {
  surfaceError?: boolean;
  entry?: StageEntry;
}

export async function switchLocalKalaidoscope(
  targetId: string,
  { surfaceError = true, entry }: SwitchOptions = {},
): Promise<Result<void, Error>> {
  const seq = cancelPendingClientOpen();

  const meta = allKalaidoscopes(desktopScope.state).find(
    (k) => k.id === targetId,
  );
  if (!meta) {
    const error = new Error(
      `This kalaidoscope is no longer registered on this device (${targetId}).`,
    );
    console.error("Workspace metadata not found:", targetId);
    if (surfaceError) {
      setAppStage({
        stage: "kalaidoscope_load_error",
        error: { message: error.message },
        retryKalaidoscopeId: targetId,
        source: "local_startup",
      });
    }
    return err(error);
  }

  if (surfaceError) {
    setAppStage({
      stage: "kalaidoscope_loading",
      loadKalaidoscopeId: targetId,
    });
  }

  const controller = new AbortController();
  registerPendingClientController(seq, controller);

  try {
    await teardownActiveClient({ cancelPending: false });
    if (!isCurrentClientOpen(seq) || controller.signal.aborted) {
      return err(new Error("Workspace switch superseded."));
    }

    // cloud/local_net need no sidecar — the per-scope client connects directly.
    if (meta.type === "local_file") {
      const startResult = await startLocalKalaidoscope(meta.locator);
      if (startResult.isErr()) throw startResult.error;
    }

    // The sidecar (if any) is up by now, so creating the client is cheap and
    // `kalaidoscope_open` means "client ready".
    const client = await createKalaidoscopeClient(meta, {
      signal: controller.signal,
    });
    if (!isCurrentClientOpen(seq) || controller.signal.aborted) {
      client.cancelAllRequests();
      return err(new Error("Workspace switch superseded."));
    }

    setActiveKalaidoscopeClient(client);

    openKalaidoscope(targetId, entry);
    await setLastOpenedKalaidoscopeId(targetId);

    if (meta.type === "local_file") {
      void getLocalKalaidoscopeStatus(targetId).then((res) => {
        if (res.isOk() && isCurrentClientOpen(seq)) setSidecarStatus(res.value);
      });
    }

    return ok(undefined);
  } catch (error) {
    if (!isCurrentClientOpen(seq) || controller.signal.aborted) {
      return err(toError(error));
    }
    console.error("Failed to switch kalaidoscope:", error);
    await teardownActiveClient({ cancelPending: false });
    if (error instanceof CloudAuthRequiredError) {
      if (surfaceError) {
        setAppStage({
          stage: "no_kalaidoscopes_available",
          entry: "onboarding-login",
        });
      }
      return err(error);
    }
    if (surfaceError) {
      setAppStage({
        stage: "kalaidoscope_load_error",
        error: stageError(error),
        retryKalaidoscopeId: targetId,
        source: meta.type === "cloud" ? "cloud_startup" : "local_startup",
      });
    }
    return err(toError(error));
  } finally {
    clearPendingClientController(controller);
  }
}

/**
 * Forget a kalaidoscope on this device. The registration goes; a local
 * workspace's files on disk stay. Any sidecar for it is stopped — switching
 * away never stops one, so a local workspace may still be running even when
 * it is not the open one.
 */
export async function closeIfActive(targetId: string): Promise<void> {
  const currentStage = desktopScope.state.appStage;
  const isActive =
    currentStage.stage === "kalaidoscope_open" &&
    currentStage.selectedKalaidoscopeId === targetId;

  if (isActive) {
    await teardownActiveClient();
    await setLastOpenedKalaidoscopeId(null);
    setAppStage({ stage: "no_kalaidoscopes_available" });
  }
}

export async function removeKalaidoscope(
  targetId: string,
): Promise<Result<void, Error>> {
  const meta = allKalaidoscopes(desktopScope.state).find(
    (k) => k.id === targetId,
  );
  await removeRegisteredKalaidoscope(targetId);
  await desktopScope.flush();

  await closeIfActive(targetId);

  if (meta?.type === "local_file") {
    // A no-op when nothing is running for this id; only a sidecar still
    // starting up refuses, and that one exits with the app.
    const stopped = await stopLocalKalaidoscope(targetId);
    if (stopped.isErr()) {
      console.error("Failed to stop removed kalaidoscope:", stopped.error);
    }
  }

  return ok(undefined);
}
