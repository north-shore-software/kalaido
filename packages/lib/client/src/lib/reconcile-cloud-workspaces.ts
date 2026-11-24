import type { KalaidoscopeMeta } from "@kalaido/platform";

export function reconcileCloudWorkspaces(
  knownList: readonly KalaidoscopeMeta[],
  remoteList: readonly KalaidoscopeMeta[],
): KalaidoscopeMeta[] {
  const remote = new Map(remoteList.map((meta) => [meta.id, meta]));
  const reconciled: KalaidoscopeMeta[] = [];

  for (const known of knownList) {
    if (known.type !== "cloud") {
      reconciled.push(known);
      continue;
    }
    const fresh = remote.get(known.id);
    if (!fresh) continue;
    reconciled.push({ ...known, ...fresh, archivedAt: fresh.archivedAt });
    remote.delete(known.id);
  }

  reconciled.push(...remote.values());
  return reconciled;
}
