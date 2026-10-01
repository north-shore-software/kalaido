import { err, type Result } from "neverthrow";
import {
  registerSidecarStatusChangeListener,
  type UnlistenFn,
} from "@/api/app/local-scopes.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { activeClient } from "@/api/kalaidoscope/_active.ts";
import {
  restoreBackup,
  waitForCloudHealthy,
} from "@/api/kalaidoscope/backups.ts";
import { setAppStage } from "@/hooks/app-state-actions.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";

async function waitForLocalStopped(id: string): Promise<boolean> {
  let unlisten: UnlistenFn | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, 120_000);

      registerSidecarStatusChangeListener((status) => {
        if (status.id === id && status.phase === "stopped") {
          resolve(true);
        }
      })
        .then((sub) => {
          if (sub.isErr()) {
            resolve(false);
            return;
          }
          unlisten = sub.value;
        })
        .catch(() => {
          resolve(false);
        });
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (unlisten) {
      unlisten();
    }
  }
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
  if (meta.type === "cloud") {
    const clientRes = activeClient();
    if (clientRes.isErr()) {
      return err(clientRes.error);
    }
    baseURL = clientRes.value.baseURL;
  }

  const restoreResult = await restoreBackup(backupId);
  if (restoreResult.isErr()) {
    return err(restoreResult.error);
  }

  setAppStage({ stage: "kalaidoscope_loading" });

  let healthy = false;
  if (meta.type === "local_file") {
    healthy = await waitForLocalStopped(meta.id);
  } else if (meta.type === "cloud") {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    healthy = await waitForCloudHealthy(baseURL, 120_000);
  }

  if (!healthy) {
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

  return await switchLocalKalaidoscope(meta.id);
}
