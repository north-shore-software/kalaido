import { err, type Result } from "neverthrow";
import {
  registerSidecarStatusChangeListener,
  type UnlistenFn,
} from "@/api/app/local-scopes.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { restoreBackup } from "@/api/kalaidoscope/backups.ts";
import { setAppStage } from "@/hooks/app-state-actions.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";

export async function restoreKalaidoscope(
  meta: KalaidoscopeMeta,
  backupId: string,
): Promise<Result<void, Error>> {
  if (meta.type !== "local_file") {
    return err(
      new Error("Restore is not supported for this workspace type yet"),
    );
  }

  const restoreResult = await restoreBackup(backupId);
  if (restoreResult.isErr()) {
    return err(restoreResult.error);
  }

  setAppStage({ stage: "kalaidoscope_loading" });

  let unlisten: UnlistenFn | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const stopped = await new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, 120_000);

      registerSidecarStatusChangeListener((status) => {
        if (status.id === meta.id && status.phase === "stopped") {
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

    if (!stopped) {
      if (unlisten) {
        unlisten();
        unlisten = undefined;
      }
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

    if (unlisten) {
      unlisten();
      unlisten = undefined;
    }

    return await switchLocalKalaidoscope(meta.id);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (unlisten) {
      unlisten();
    }
  }
}
