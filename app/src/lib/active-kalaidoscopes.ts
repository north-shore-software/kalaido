import type { KalaidoscopeMeta } from "@/api/app/types.ts";

export function isArchived(meta: KalaidoscopeMeta): boolean {
  return !!meta.archivedAt;
}

export function activeKalaidoscopes<T extends KalaidoscopeMeta>(
  list: readonly T[],
): T[] {
  return list.filter((k) => !isArchived(k));
}
