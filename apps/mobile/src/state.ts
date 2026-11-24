import { signOutCloudAuth } from "@kalaido/client/cloud/auth";
import { listCloudKalaidoscopes } from "@kalaido/client/cloud/user";
import { createCloudClient } from "@kalaido/client/kalaidoscope/client";
import { setActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { isArchived } from "@kalaido/client/lib/active-kalaidoscopes";
import {
  type StageError,
  stageError,
  toError,
} from "@kalaido/client/lib/errors";
import { resetPostHog } from "@kalaido/client/lib/posthog";
import { reconcileCloudWorkspaces } from "@kalaido/client/lib/reconcile-cloud-workspaces";
import { getHost, type KalaidoscopeMeta } from "@kalaido/platform";
import { err, ok, type Result } from "neverthrow";
import { proxy } from "valtio";

export type CloudStage =
  | { stage: "bootstrap" | "signed_out" | "workspace_loading" }
  | { stage: "bootstrap_error"; error?: StageError }
  | { stage: "workspace_load_error"; error?: StageError }
  | { stage: "workspace_open"; workspaceId: string }
  | { stage: "workspace_load_requested"; workspaceId: string };

export type CloudAppState = {
  stage: CloudStage;
  workspaces: KalaidoscopeMeta[];
};

export const cloudState = proxy<CloudAppState>({
  stage: { stage: "bootstrap" },
  workspaces: [],
});

export async function bootstrapCloudState(): Promise<void> {
  try {
    const stored = await getHost().settings.getAll();
    if (stored.isErr()) {
      cloudState.stage = {
        stage: "bootstrap_error",
        error: stageError(stored.error),
      };
      return;
    }

    const savedWorkspaces = (stored.value.availableKalaidoscopes ?? []).filter(
      (k) => k.type === "cloud",
    );
    cloudState.workspaces = savedWorkspaces;

    const lastOpenedId = stored.value.lastOpenedKalaidoscopeId;
    const lastOpened = savedWorkspaces.find(
      (k) => k.id === lastOpenedId && !isArchived(k),
    );
    cloudState.stage = lastOpened
      ? { stage: "workspace_load_requested", workspaceId: lastOpened.id }
      : { stage: "signed_out" };
  } catch (e) {
    cloudState.stage = {
      stage: "bootstrap_error",
      error: stageError(e),
    };
  }
}

export async function syncCloudWorkspaces(): Promise<Result<void, Error>> {
  const listed = await listCloudKalaidoscopes();
  if (listed.isErr()) return err(listed.error);

  const reconciled = reconcileCloudWorkspaces(
    cloudState.workspaces,
    listed.value,
  );
  cloudState.workspaces = reconciled;

  const persisted = await getHost().settings.set(
    "availableKalaidoscopes",
    reconciled,
  );
  if (persisted.isErr()) {
    console.error(
      "Cloud sync: failed to persist workspace list:",
      persisted.error,
    );
  }

  return ok(undefined);
}

export async function openCloudWorkspace(
  targetId: string,
  { surfaceError = false }: { surfaceError?: boolean } = {},
): Promise<Result<void, Error>> {
  const meta = cloudState.workspaces.find((k) => k.id === targetId);
  if (!meta) {
    const error = new Error(
      `This kalaidoscope is no longer registered (${targetId}).`,
    );
    if (surfaceError) {
      cloudState.stage = {
        stage: "workspace_load_error",
        error: { message: error.message },
      };
    }
    return err(error);
  }

  if (surfaceError) {
    cloudState.stage = { stage: "workspace_loading" };
  }

  try {
    setActiveKalaidoscopeClient(await createCloudClient(meta.locator));
    cloudState.stage = { stage: "workspace_open", workspaceId: targetId };

    const remembered = await getHost().settings.set(
      "lastOpenedKalaidoscopeId",
      targetId,
    );
    if (remembered.isErr()) {
      console.error("Failed to remember the open workspace:", remembered.error);
    }

    return ok(undefined);
  } catch (e) {
    setActiveKalaidoscopeClient(null);
    if (surfaceError) {
      cloudState.stage = {
        stage: "workspace_load_error",
        error: stageError(e),
      };
    }
    return err(toError(e));
  }
}

export async function signOutOfCloud(): Promise<void> {
  resetPostHog();
  await signOutCloudAuth();
  cloudState.workspaces = [];
  const host = getHost();
  await host.settings.set("availableKalaidoscopes", []);
  await host.settings.delete("lastOpenedKalaidoscopeId");
  setActiveKalaidoscopeClient(null);
  host.reload();
}
