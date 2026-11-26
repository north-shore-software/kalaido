import { toError } from "@kalaido/client/lib/errors";
import { isTauri } from "@tauri-apps/api/core";
import { err, ok, type Result } from "neverthrow";
import { toast } from "sonner";

export { isTauri };

export function notifyUnsupportedTauriAction(
  action: string,
  opts?: { silent?: boolean },
): void {
  if (opts?.silent) return;
  toast.info("Not supported outside Tauri", {
    description: action,
    id: `unsupported-tauri:${action}`,
  });
}

export async function tauriResult<T>(p: Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await p);
  } catch (e) {
    return err(toError(e));
  }
}

export function tauriCall<T>(
  action: string,
  run: () => Promise<T>,
  fallback: T,
  opts?: { silent?: boolean },
): Promise<Result<T, Error>> {
  if (!isTauri()) {
    notifyUnsupportedTauriAction(action, opts);
    return Promise.resolve(ok(fallback));
  }
  return tauriResult(run());
}
