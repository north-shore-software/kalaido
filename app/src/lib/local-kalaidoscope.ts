import { err, ok, type Result } from "neverthrow";
import { startLocalKalaidoscope } from "@/api/app/local-scopes";
import { setSetting } from "@/api/app/settings.ts";
import { createKalaidoscopeClient } from "@/api/kalaidoscope/client.ts";
import { openKalaidoscope, setAppStage } from "@/hooks/app-state-actions.ts";
import {
  appState,
  type StageEntry,
  stageError,
} from "@/hooks/use-app-state.ts";
import { setActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client.ts";
import { toError } from "@/lib/errors.ts";

export interface SwitchOptions {
  surfaceError?: boolean;
  entry?: StageEntry;
}

export async function switchLocalKalaidoscope(
  targetId: string,
  { surfaceError = true, entry }: SwitchOptions = {},
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

    openKalaidoscope(targetId, entry);

    // The setting is what boot reopens on next launch, so it has to track what
    // is actually open. It used to be written only on creation, which made it
    // "last created" — switch workspaces, restart, and you were returned to the
    // wrong one. Persisting here also means signing out of a cloud workspace
    // can reliably tell whether the workspace being reopened is the one that
    // just became unreachable.
    const remembered = await setSetting("lastOpenedKalaidoscopeId", targetId);
    if (remembered.isErr()) {
      // The workspace is open and usable; only the next launch is affected.
      console.error("Failed to remember the open workspace:", remembered.error);
    }

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
