import {
  configureCloudSessionTokenBridge,
  signOutCloudAuth,
} from "@kalaido/client/cloud/auth";
import { listCloudKalaidoscopes } from "@kalaido/client/cloud/user";
import {
  CloudAuthRequiredError,
  createCloudClient,
} from "@kalaido/client/kalaidoscope/client";
import {
  getActiveKalaidoscopeClient,
  setActiveKalaidoscopeClient,
} from "@kalaido/client/lib/active-kalaidoscope-client";
import { isArchived } from "@kalaido/client/lib/active-kalaidoscopes";
import {
  type StageError,
  stageError,
  toError,
} from "@kalaido/client/lib/errors";
import { resetPostHog } from "@kalaido/client/lib/posthog";
import { reconcileCloudWorkspaces } from "@kalaido/client/lib/reconcile-cloud-workspaces";
import {
  getHost,
  type KalaidoscopeMeta,
  type SettingsStore,
  type ThemePreference,
} from "@kalaido/platform";
import { invalidateLiveTags } from "@kalaido/state/live";
import { disposeClientSubscriptions } from "@kalaido/state/pocketbase";
import {
  createScope,
  type PersistedScopeInstance,
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { err, ok, type Result } from "neverthrow";
import { useMemo } from "react";
import { createScopeContext, useScopeContext } from "#create-scope-context";
import {
  clearCloudLiveCache,
  clearWorkspaceLiveCache,
} from "#kalaidoscope-live";
import { hostSettingsPersistence } from "#scope-persistence";
import {
  CLOUD_WORKSPACES_TAG,
  useCloudWorkspaces,
} from "#use-cloud-workspaces";

export type CloudStage =
  | { stage: "bootstrap" | "signed_out" | "workspace_picker" }
  | { stage: "workspace_loading"; workspaceId?: string }
  | { stage: "bootstrap_error"; error?: StageError }
  | { stage: "workspace_load_error"; error?: StageError; workspaceId?: string }
  | { stage: "workspace_open"; workspaceId: string }
  | { stage: "workspace_load_requested"; workspaceId: string };

export interface CloudRootState {
  theme: ThemePreference;
  cloudSessionToken?: string;
  lastOpenedKalaidoscopeId?: string;
  cachedCloudKalaidoscopes: KalaidoscopeMeta[];
  stage: CloudStage;
  recentExploreConversationIds: Record<string, string>;
}

export type CloudRootEvent =
  | { readonly type: "setTheme"; readonly theme: ThemePreference }
  | { readonly type: "setCloudSessionToken"; readonly token: string | null }
  | {
      readonly type: "setCachedCloudKalaidoscopes";
      readonly workspaces: KalaidoscopeMeta[];
    }
  | { readonly type: "setStage"; readonly stage: CloudStage }
  | { readonly type: "setLastOpenedKalaidoscopeId"; readonly id: string | null }
  | {
      readonly type: "setRecentExploreConversationId";
      readonly workspaceId: string;
      readonly conversationId: string | null;
    }
  | { readonly type: "signOut" };

export type CloudRootScopeInstance = PersistedScopeInstance<
  CloudRootState,
  CloudRootEvent
>;

export const CloudRootScopeContext = createScopeContext<
  CloudRootState,
  CloudRootEvent
>("CloudRootScope");

const CLOUD_PERSIST_KEYS = [
  "theme",
  "cloudSessionToken",
  "lastOpenedKalaidoscopeId",
  "cachedCloudKalaidoscopes",
] as const;

interface PendingCloudOpenTracker {
  seq: number;
  controller: AbortController | null;
}

const pendingCloudOpens = new WeakMap<
  CloudRootScopeInstance,
  PendingCloudOpenTracker
>();

function getOpenTracker(
  scope: CloudRootScopeInstance,
): PendingCloudOpenTracker {
  let tracker = pendingCloudOpens.get(scope);
  if (!tracker) {
    tracker = { seq: 0, controller: null };
    pendingCloudOpens.set(scope, tracker);
  }
  return tracker;
}

function cancelPendingCloudOpen(scope: CloudRootScopeInstance): number {
  const tracker = getOpenTracker(scope);
  tracker.seq += 1;
  tracker.controller?.abort();
  tracker.controller = null;
  return tracker.seq;
}

export function createCloudRootScope(
  settings?: SettingsStore,
): CloudRootScopeInstance {
  const handlers: ScopeHandlers<CloudRootState, CloudRootEvent> = {
    setTheme: (s, e) => {
      s.theme = e.theme;
    },
    setCloudSessionToken: (s, e) => {
      if (e.token === null) {
        delete s.cloudSessionToken;
      } else {
        s.cloudSessionToken = e.token;
      }
    },
    setCachedCloudKalaidoscopes: (s, e) => {
      s.cachedCloudKalaidoscopes = e.workspaces;
    },
    setStage: (s, e) => {
      s.stage = e.stage;
    },
    setLastOpenedKalaidoscopeId: (s, e) => {
      if (e.id === null) {
        delete s.lastOpenedKalaidoscopeId;
      } else {
        s.lastOpenedKalaidoscopeId = e.id;
      }
    },
    setRecentExploreConversationId: (s, e) => {
      if (e.conversationId === null) {
        delete s.recentExploreConversationIds[e.workspaceId];
      } else {
        s.recentExploreConversationIds[e.workspaceId] = e.conversationId;
      }
    },
    signOut: (s) => {
      delete s.cloudSessionToken;
      delete s.lastOpenedKalaidoscopeId;
      s.cachedCloudKalaidoscopes = [];
      s.recentExploreConversationIds = {};
      s.stage = { stage: "signed_out" };
    },
  };

  return createScope({
    initial: (): CloudRootState => ({
      theme: "system",
      cachedCloudKalaidoscopes: [],
      stage: { stage: "bootstrap" },
      recentExploreConversationIds: {},
    }),
    handlers,
    persist: {
      keys: CLOUD_PERSIST_KEYS,
      adapter: hostSettingsPersistence(CLOUD_PERSIST_KEYS, settings),
      onHydrated: (state, result) => {
        if (result.isErr()) {
          state.stage = {
            stage: "bootstrap_error",
            error: stageError(result.error),
          };
          return;
        }
        const saved = (state.cachedCloudKalaidoscopes ?? []).filter(
          (k) => k.type === "cloud",
        );
        state.cachedCloudKalaidoscopes = saved;
        const lastOpened = saved.find(
          (k) => k.id === state.lastOpenedKalaidoscopeId && !isArchived(k),
        );
        state.stage = lastOpened
          ? { stage: "workspace_load_requested", workspaceId: lastOpened.id }
          : { stage: "signed_out" };
      },
    },
  });
}

/**
 * Connect `@kalaido/client/cloud/auth` to `scope.state.cloudSessionToken`.
 * Returns a detach function to call before disposing `scope` on reset/reload.
 */
export function wireCloudScopeTokenBridge(
  scope: CloudRootScopeInstance,
): () => void {
  let active = true;
  configureCloudSessionTokenBridge({
    get: () => scope.state.cloudSessionToken ?? null,
    onChange: (token) => {
      if (!active) return;
      void scope
        .dispatch({ type: "setCloudSessionToken", token })
        .catch(() => {});
    },
  });
  return () => {
    active = false;
    configureCloudSessionTokenBridge(null);
  };
}

export async function teardownActiveCloudClient(): Promise<void> {
  const prev = getActiveKalaidoscopeClient();
  setActiveKalaidoscopeClient(null);
  if (!prev) return;
  disposeClientSubscriptions(prev);
  prev.cancelAllRequests();
  await clearWorkspaceLiveCache(prev.baseURL);
}

export async function syncCloudWorkspacesForScope(
  scope: CloudRootScopeInstance,
): Promise<Result<void, Error>> {
  const listed = await listCloudKalaidoscopes();
  if (listed.isErr()) return err(listed.error);

  const reconciled = reconcileCloudWorkspaces(
    scope.state.cachedCloudKalaidoscopes,
    listed.value,
  );
  await scope.dispatch({
    type: "setCachedCloudKalaidoscopes",
    workspaces: reconciled,
  });
  await invalidateLiveTags([CLOUD_WORKSPACES_TAG]);
  return ok(undefined);
}

export async function showCloudWorkspacePickerForScope(
  scope: CloudRootScopeInstance,
): Promise<void> {
  cancelPendingCloudOpen(scope);
  await teardownActiveCloudClient();
  await scope.dispatch({
    type: "setStage",
    stage: { stage: "workspace_picker" },
  });
}

export async function openCloudWorkspaceForScope(
  scope: CloudRootScopeInstance,
  targetId: string,
  { surfaceError = true }: { surfaceError?: boolean } = {},
): Promise<Result<void, Error>> {
  const tracker = getOpenTracker(scope);
  const seq = cancelPendingCloudOpen(scope);

  const meta = scope.state.cachedCloudKalaidoscopes.find(
    (k) => k.id === targetId,
  );
  if (!meta) {
    const error = new Error(
      `This kalaidoscope is no longer registered (${targetId}).`,
    );
    if (surfaceError) {
      await scope.dispatch({
        type: "setStage",
        stage: {
          stage: "workspace_load_error",
          error: { message: error.message },
          workspaceId: targetId,
        },
      });
    }
    return err(error);
  }

  if (surfaceError) {
    await scope.dispatch({
      type: "setStage",
      stage: { stage: "workspace_loading", workspaceId: targetId },
    });
  }

  const controller = new AbortController();
  tracker.controller = controller;

  try {
    await teardownActiveCloudClient();
    if (tracker.seq !== seq || controller.signal.aborted) {
      return err(new Error("Workspace switch superseded."));
    }

    const client = await createCloudClient(meta.locator, {
      signal: controller.signal,
    });
    if (tracker.seq !== seq || controller.signal.aborted) {
      client.cancelAllRequests();
      return err(new Error("Workspace switch superseded."));
    }

    setActiveKalaidoscopeClient(client);
    await scope.dispatch({
      type: "setStage",
      stage: { stage: "workspace_open", workspaceId: targetId },
    });
    await scope.dispatch({
      type: "setLastOpenedKalaidoscopeId",
      id: targetId,
    });
    return ok(undefined);
  } catch (e) {
    if (tracker.seq !== seq || controller.signal.aborted) {
      return err(toError(e));
    }
    await teardownActiveCloudClient();
    if (e instanceof CloudAuthRequiredError) {
      if (surfaceError) {
        await scope.dispatch({
          type: "setStage",
          stage: { stage: "signed_out" },
        });
      }
      return err(e);
    }
    if (surfaceError) {
      await scope.dispatch({
        type: "setStage",
        stage: {
          stage: "workspace_load_error",
          error: stageError(e),
          workspaceId: targetId,
        },
      });
    }
    return err(toError(e));
  } finally {
    if (tracker.controller === controller) {
      tracker.controller = null;
    }
  }
}

export async function signOutOfCloudForScope(
  scope: CloudRootScopeInstance,
  detachTokenBridge?: () => void,
): Promise<void> {
  cancelPendingCloudOpen(scope);
  resetPostHog();
  await signOutCloudAuth();
  await teardownActiveCloudClient();
  await clearCloudLiveCache();
  await scope.dispatch({ type: "signOut" });
  await scope.flush();
  detachTokenBridge?.();
  getHost().reload();
}

export async function prepareCloudScopeReset(
  scope: CloudRootScopeInstance,
  detachTokenBridge?: () => void,
): Promise<void> {
  cancelPendingCloudOpen(scope);
  detachTokenBridge?.();
  await teardownActiveCloudClient();
  await clearCloudLiveCache();
  scope.dispose();
  await scope.flush();
}

export function pathForCloudStage(stage: CloudStage): string {
  switch (stage.stage) {
    case "bootstrap":
    case "workspace_loading":
    case "workspace_load_requested":
      return "/splash";
    case "bootstrap_error":
    case "workspace_load_error":
      return "/boot-error";
    case "signed_out":
      return "/login";
    case "workspace_picker":
      return "/workspaces";
    case "workspace_open":
      return "/explore";
  }
}

export function useCloudWorkspacesList(): readonly KalaidoscopeMeta[] {
  const root = useScopeContext(CloudRootScopeContext);
  const wsScope = useScope({
    from: root,
    state: ["cachedCloudKalaidoscopes"],
    events: ["setCachedCloudKalaidoscopes"],
  });
  const { cachedCloudKalaidoscopes } = useScopeState(wsScope);
  const offlineBridge = useMemo(
    () => ({
      read: () => wsScope.state.cachedCloudKalaidoscopes,
      write: (workspaces: KalaidoscopeMeta[]) =>
        wsScope.dispatch({
          type: "setCachedCloudKalaidoscopes",
          workspaces,
        }),
    }),
    [wsScope],
  );
  const live = useCloudWorkspaces({ offlineBridge });
  return live.data ?? cachedCloudKalaidoscopes;
}
