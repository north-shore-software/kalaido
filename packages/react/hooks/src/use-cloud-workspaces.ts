import { getCloudSessionToken } from "@kalaido/client/cloud/auth";
import { listCloudKalaidoscopes } from "@kalaido/client/cloud/user";
import { reconcileCloudWorkspaces } from "@kalaido/client/lib/reconcile-cloud-workspaces";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import {
  httpLiveSource,
  type LiveOfflineCache,
  type LiveReadResult,
  useLiveRead,
} from "@kalaido/state/live";
import { useMemo } from "react";
import { useCloudSession } from "#use-cloud-session";

export const CLOUD_WORKSPACES_TAG = "cloud:workspaces";
export const CLOUD_WORKSPACES_KEY = ["cloud", "workspaces"] as const;

export interface CloudWorkspacesOfflineBridge {
  /** Read the cached cloud workspaces from the app's persisted root scope. */
  readonly read: () => readonly KalaidoscopeMeta[];
  /**
   * Persist reconciled cloud workspaces back through the app's root scope.
   * Only invoked while a cloud session token is active.
   */
  readonly write: (workspaces: KalaidoscopeMeta[]) => void | Promise<void>;
}

export interface UseCloudWorkspacesOptions {
  /** Override signed-in gating (defaults to `useCloudSession().signedIn`). */
  readonly enabled?: boolean;
  /**
   * Root-scope persistence bridge for `cachedCloudKalaidoscopes`.
   * When provided, offline reads hydrate from the root scope and online fetches
   * reconcile and write back through the root scope (guarded on an active token).
   */
  readonly offlineBridge?: CloudWorkspacesOfflineBridge;
}

export interface UseCloudWorkspacesResult
  extends LiveReadResult<KalaidoscopeMeta[]> {
  readonly workspaces: KalaidoscopeMeta[];
}

/**
 * Shared live read for the signed-in user's Kalaido Cloud workspaces
 * (`GET /kalaidoscopes`), backed by `@kalaido/state` with optional root-scope
 * offline cache reconciliation.
 */
export function useCloudWorkspaces(
  options: UseCloudWorkspacesOptions = {},
): UseCloudWorkspacesResult {
  const { signedIn } = useCloudSession();
  const enabled = options.enabled ?? signedIn;
  const offlineBridge = options.offlineBridge;

  const offlineCache = useMemo<
    LiveOfflineCache<KalaidoscopeMeta[]> | undefined
  >(() => {
    if (!offlineBridge) return undefined;
    return {
      read: async () => {
        const cached = offlineBridge.read();
        return cached.length > 0 ? [...cached] : undefined;
      },
      reconcile: (cached, fresh) =>
        reconcileCloudWorkspaces(cached ?? [], fresh),
      write: async (reconciled) => {
        if (getCloudSessionToken().isErr()) return;
        try {
          await offlineBridge.write(reconciled);
        } catch (e) {
          if (e instanceof Error && /disposed/i.test(e.message)) return;
          throw e;
        }
      },
    };
  }, [offlineBridge]);

  const result = useLiveRead<KalaidoscopeMeta[]>(
    httpLiveSource({
      key: enabled ? CLOUD_WORKSPACES_KEY : null,
      tags: [CLOUD_WORKSPACES_TAG],
      fetch: listCloudKalaidoscopes,
      offlineCache,
    }),
  );

  const workspaces = useMemo<KalaidoscopeMeta[]>(
    () => result.data ?? [],
    [result.data],
  );

  return {
    ...result,
    workspaces,
  };
}
