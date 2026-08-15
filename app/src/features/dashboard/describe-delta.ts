import type { EntityStatus } from "@/api/kalaidoscope/rotation";

/** "Weekly digest", "Weekly digest and Standups", "A, B and 2 more". */
export function joinNames(
  ids: string[],
  nameFor: (id: string) => string,
): string {
  const names = ids.map(nameFor);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * The one-line reason an entity needs action. `blockedBy` and
 * `staleDependencies` both name upstreams but mean opposite things, so they get
 * opposite phrasings: waiting on someone else, versus work that can be done now.
 */
export function describeDelta(
  s: EntityStatus,
  nameFor: (id: string) => string,
): string {
  const blocked = s.blockedBy ?? [];
  if (blocked.length > 0) return `waiting on ${joinNames(blocked, nameFor)}`;

  const nf = s.newFragmentIds?.length ?? 0;
  const pw = s.pendingWindows?.length ?? 0;
  const stale = s.staleDependencies ?? [];
  const parts: string[] = [];
  if (nf > 0) parts.push(`${nf} new fragment${nf > 1 ? "s" : ""}`);
  if (pw > 0) parts.push(`${pw} window${pw > 1 ? "s" : ""} due`);
  if (stale.length > 0) parts.push(`${joinNames(stale, nameFor)} updated`);
  return parts.join(" · ") || "needs refresh";
}
