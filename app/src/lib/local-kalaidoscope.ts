import { err, ok, type Result } from "neverthrow";
import { startLocalKalaidoscope } from "@/api/app/local-scopes";
import { appState, stageError } from "@/hooks/use-app-state.ts";
import { createKalaidoscopeClient } from "@/api/kalaidoscope/client.ts";
import { setActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client.ts";
import { openKalaidoscope, setAppStage } from "@/hooks/app-state-actions.ts";
import { toError } from "@/lib/errors.ts";

export interface SwitchOptions {
  surfaceError?: boolean;
}

export async function switchLocalKalaidoscope(
  targetId: string,
  { surfaceError = true }: SwitchOptions = {},
): Promise<Result<void, Error>> {
  const meta = appState.availableKalaidoscopes.find((k) => k.id === targetId);
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
      });
    }
    return err(error);
  }

  if (surfaceError) setAppStage({ stage: "kalaidoscope_loading" });

  try {
    // cloud/local_net need no sidecar — the per-scope client connects directly.
    if (meta.type === "local_file") {
      const startResult = await startLocalKalaidoscope(meta.locator);
      if (startResult.isErr()) throw startResult.error;
    }

    // The sidecar (if any) is up by now, so creating the client is cheap and
    // `kalaidoscope_open` means "client ready".
    setActiveKalaidoscopeClient(await createKalaidoscopeClient(meta));

    openKalaidoscope(targetId);
    return ok(undefined);
  } catch (error) {
    console.error("Failed to switch kalaidoscope:", error);
    setActiveKalaidoscopeClient(null);
    if (surfaceError) {
      setAppStage({
        stage: "kalaidoscope_load_error",
        error: stageError(error),
        retryKalaidoscopeId: targetId,
      });
    }
    return err(toError(error));
  }
}
