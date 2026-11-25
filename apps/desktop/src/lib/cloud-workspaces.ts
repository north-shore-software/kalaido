import {
  listCloudKalaidoscopes,
  setCloudArchived,
} from "@kalaido/client/cloud/user";
import { reconcileCloudWorkspaces } from "@kalaido/client/lib/reconcile-cloud-workspaces";
import { CLOUD_WORKSPACES_TAG } from "@kalaido/hooks/use-cloud-workspaces";
import { invalidateLiveTags } from "@kalaido/state/live";
import { err, ok, type Result } from "neverthrow";
import { closeIfActive } from "@/lib/local-kalaidoscope.ts";
import { desktopScope } from "@/state/app-state.ts";
import { setCachedCloudKalaidoscopes } from "@/state/app-state-actions.ts";

/**
 * Reconciles the locally-known cloud workspace list with what the signed-in
 * account actually owns.
 *
 * Local workspaces are stored separately in `localKalaidoscopes` and never
 * touched here. Pruning happens only on a successful list so an offline launch
 * leaves the cached cloud list intact.
 */
export async function syncCloudWorkspaces(): Promise<Result<void, Error>> {
  const listed = await listCloudKalaidoscopes();
  if (listed.isErr()) return err(listed.error);

  const reconciled = reconcileCloudWorkspaces(
    desktopScope.state.cachedCloudKalaidoscopes,
    listed.value,
  );

  await setCachedCloudKalaidoscopes(reconciled);
  await invalidateLiveTags([CLOUD_WORKSPACES_TAG]);

  return ok(undefined);
}

export async function setKalaidoscopeArchived(
  targetId: string,
  archived: boolean,
): Promise<Result<void, Error>> {
  const meta = desktopScope.state.cachedCloudKalaidoscopes.find(
    (k) => k.id === targetId,
  );
  if (meta?.type !== "cloud") {
    return err(new Error("Only cloud kalaidoscopes can be archived."));
  }

  const updated = await setCloudArchived(meta.locator, archived);
  if (updated.isErr()) return err(updated.error);

  const next = desktopScope.state.cachedCloudKalaidoscopes.map((k) =>
    k.id === targetId
      ? { ...k, archivedAt: archived ? new Date().toISOString() : undefined }
      : k,
  );
  await setCachedCloudKalaidoscopes(next);
  await invalidateLiveTags([CLOUD_WORKSPACES_TAG]);

  if (archived) await closeIfActive(targetId);

  return ok(undefined);
}
