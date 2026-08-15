import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import { setSetting } from "@/api/app/settings.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { listCloudKalaidoscopes } from "@/api/cloud/user.ts";
import { setAvailableKalaidoscopes } from "@/hooks/app-state-actions.ts";
import { appState } from "@/hooks/use-app-state.ts";

/**
 * Reconciles the locally-known workspace list with what the signed-in account
 * actually owns.
 *
 * The cloud registry is authoritative for `type === "cloud"`, not merely a
 * source of additions. Merging without pruning meant a workspace deleted
 * server-side stayed on screen forever, and signing in as a second account
 * showed the first account's workspaces — unopenable, and masking the genuine
 * "you have none yet" state, since the list was never actually empty.
 *
 * Local workspaces are never touched: they belong to the device, not the
 * account, and the cloud has no opinion about them.
 *
 * Pruning happens only on a **successful** list. A failed request tells us
 * nothing about what exists, so an offline launch must leave the list exactly
 * as it was rather than reading "no response" as "no workspaces".
 */
export async function syncCloudWorkspaces(): Promise<Result<void, Error>> {
  const listed = await listCloudKalaidoscopes();
  if (listed.isErr()) return err(listed.error);

  const remote = new Map(listed.value.map((meta) => [meta.id, meta]));
  const reconciled: KalaidoscopeMeta[] = [];

  // Walk the known list first so surviving workspaces hold their position —
  // a re-fetch should not reshuffle the grid the user is looking at.
  for (const known of appState.availableKalaidoscopes) {
    if (known.type !== "cloud") {
      reconciled.push(known);
      continue;
    }
    const fresh = remote.get(known.id);
    if (!fresh) continue;
    // Locally-held fields the registry doesn't return (icon) survive the merge.
    reconciled.push({ ...known, ...fresh });
    remote.delete(known.id);
  }

  reconciled.push(...remote.values());

  setAvailableKalaidoscopes(reconciled);

  const persisted = await setSetting("availableKalaidoscopes", reconciled);
  if (persisted.isErr()) {
    // The list on screen is correct; only the next launch would be stale.
    // Surfacing this as a sync failure would put an error banner over a
    // perfectly good list, which is the worse trade.
    console.error(
      "Cloud sync: failed to persist workspace list:",
      persisted.error,
    );
  }

  return ok(undefined);
}
