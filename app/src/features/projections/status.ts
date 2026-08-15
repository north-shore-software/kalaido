import type { EntityStatus } from "@/api/kalaidoscope/rotation";

export type ProjectionStatus = "stable" | "pending" | "stale" | "blocked";

export interface ProjectionStatusInfo {
  status: ProjectionStatus;
  /** New in-context fragments since the live snapshot (the "entropy" count). */
  entropy: number;
  /** Upstream ids that are not themselves up to date, so this one must wait. */
  blockedBy: string[];
}

/**
 * Resolve a projection's headline status from the server's freshness plan
 * (`EntityStatus` from `GET /api/rotation`) combined with whether a pending
 * candidate exists locally. Precedence: a pending candidate to review trumps
 * everything; then blocked-on-upstream; then stale (new fragments, due windows,
 * or an upstream that has published since); otherwise stable.
 *
 * Note that `staleDependencies` counts as stale, not blocked — an upstream that
 * has moved on is work this projection can do right now.
 */
export function getProjectionStatus(
  status: EntityStatus | undefined,
  hasPending: boolean,
): ProjectionStatusInfo {
  const entropy = status?.newFragmentIds?.length ?? 0;
  const blockedBy = status?.blockedBy ?? [];
  const staleDeps = status?.staleDependencies?.length ?? 0;
  const dueWindows = status?.pendingWindows?.length ?? 0;

  let kind: ProjectionStatus = "stable";
  if (hasPending) kind = "pending";
  else if (blockedBy.length > 0) kind = "blocked";
  else if (entropy > 0 || dueWindows > 0 || staleDeps > 0) kind = "stale";

  return { status: kind, entropy, blockedBy };
}

export function statusLabel(status: ProjectionStatus): string {
  switch (status) {
    case "stable":
      return "up to date";
    case "pending":
      return "review candidate";
    case "stale":
      return "stale";
    case "blocked":
      return "blocked";
  }
}
