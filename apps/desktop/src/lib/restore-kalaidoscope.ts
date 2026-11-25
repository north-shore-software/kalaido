import { err, ok, type Result } from "neverthrow";
import {
  registerSidecarStatusChangeListener,
  type UnlistenFn,
} from "@/api/app/local-scopes.ts";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { activeClient } from "@kalaido/client/kalaidoscope/_active";
import {
  getRestoreStatus,
  restoreBackup,
  waitForCloudRestart,
} from "@kalaido/client/kalaidoscope/backups";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { teardownActiveClient } from "@/state/app-state.ts";
import { setAppStage } from "@/state/app-state-actions.ts";

async function prepareWaitForLocalStopped(
  id: string,
  timeoutMs = 120_000,
): Promise<{ wait: () => Promise<boolean>; cleanup: () => void }> {
  let unlisten: UnlistenFn | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePromise: (value: boolean) => void;

  const promise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve;
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });

  const sub = await registerSidecarStatusChangeListener((status) => {
    if (status.id === id && status.phase === "stopped") {
      resolvePromise(true);
    }
  });

  if (sub.isOk()) {
    unlisten = sub.value;
  }

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (unlisten) unlisten();
  };

  return {
    wait: async () => {
      if (sub.isErr()) {
        cleanup();
        return false;
      }
      try {
        return await promise;
      } finally {
        cleanup();
      }
    },
    cleanup,
  };
}

export async function restoreKalaidoscope(
  meta: KalaidoscopeMeta,
  backupId: string,
): Promise<Result<void, Error>> {
  if (meta.type !== "local_file" && meta.type !== "cloud") {
    return err(
      new Error("Restore is not supported for this workspace type yet"),
    );
  }

  let baseURL = "";
  let initialBootId = "";
  if (meta.type === "cloud") {
    const clientRes = activeClient();
    if (clientRes.isErr()) {
      return err(clientRes.error);
    }
    baseURL = clientRes.value.baseURL;
    const statusRes = await getRestoreStatus();
    if (statusRes.isErr()) {
      return err(
        new Error(
          `Failed to check restore status before restoring: ${statusRes.error.message}`,
        ),
      );
    }
    initialBootId = statusRes.value.boot_id;
  }

  let stoppedWait:
    | { wait: () => Promise<boolean>; cleanup: () => void }
    | undefined;
  if (meta.type === "local_file") {
    stoppedWait = await prepareWaitForLocalStopped(meta.id);
  }

  const restoreResult = await restoreBackup(backupId);
  if (restoreResult.isErr()) {
    stoppedWait?.cleanup();
    return err(restoreResult.error);
  }

  // The restored DB may share the exact same baseURL (especially cloud), so
  // dispose SSE subscriptions and evict cached live data before reopening.
  await teardownActiveClient();

  setAppStage({ stage: "kalaidoscope_loading" });

  let restarted = false;
  if (meta.type === "local_file" && stoppedWait) {
    restarted = await stoppedWait.wait();
  } else if (meta.type === "cloud") {
    restarted = await waitForCloudRestart(baseURL, initialBootId, 120_000);
  }

  if (!restarted) {
    setAppStage({
      stage: "kalaidoscope_load_error",
      error: {
        message: "The restore did not complete. Your workspace is unchanged.",
      },
      retryKalaidoscopeId: meta.id,
    });
    return err(
      new Error("Timed out waiting for workspace to restart after restore"),
    );
  }

  const switchResult = await switchLocalKalaidoscope(meta.id);
  if (switchResult.isErr()) {
    return switchResult;
  }

  const statusRes = await getRestoreStatus();
  if (statusRes.isErr()) {
    setAppStage({
      stage: "kalaidoscope_load_error",
      error: {
        message: "The restore did not complete. Your workspace is unchanged.",
      },
      retryKalaidoscopeId: meta.id,
    });
    return err(
      new Error("Timed out waiting for workspace to restart after restore"),
    );
  }

  const lastRestore = statusRes.value.last_restore;
  if (!lastRestore || lastRestore.id !== backupId) {
    setAppStage({
      stage: "kalaidoscope_load_error",
      error: {
        message: "The restore did not complete. Your workspace is unchanged.",
      },
      retryKalaidoscopeId: meta.id,
    });
    return err(
      new Error("Timed out waiting for workspace to restart after restore"),
    );
  }

  if (!lastRestore.ok) {
    const errorLine = lastRestore.error ? `${lastRestore.error}\n` : "";
    const message = `${errorLine}Your workspace is unchanged.`;
    setAppStage({
      stage: "kalaidoscope_load_error",
      error: { message },
      retryKalaidoscopeId: meta.id,
    });
    return err(new Error(lastRestore.error || "Backup restore failed"));
  }

  return ok(undefined);
}
