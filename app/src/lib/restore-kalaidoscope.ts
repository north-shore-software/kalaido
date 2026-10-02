import { err, ok, type Result } from "neverthrow";
import {
  registerSidecarStatusChangeListener,
  type UnlistenFn,
} from "@/api/app/local-scopes.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { activeClient } from "@/api/kalaidoscope/_active.ts";
import {
  getRestoreStatus,
  restoreBackup,
  waitForCloudRestart,
} from "@/api/kalaidoscope/backups.ts";
import { setAppStage } from "@/hooks/app-state-actions.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";

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
