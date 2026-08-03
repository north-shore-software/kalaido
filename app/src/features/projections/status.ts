import type { EntityStatus } from "@/api/kalaidoscope/rotation";

export type ProjectionStatus = "stable" | "pending" | "stale" | "blocked";

export interface ProjectionStatusInfo {
  status: ProjectionStatus;
  /** New in-context fragments since the live snapshot (the "entropy" count). */
  entropy: number;
  /** Upstream ids this projection is waiting on (stale dependencies). */
  blockedBy: string[];
}

/**
 * Resolve a projection's headline status from the server's freshness plan
 * (`EntityStatus` from `GET /api/rotation`) combined with whether a pending
 * candidate exists locally. Precedence: a pending candidate to review trumps
 * everything; then blocked-on-upstream; then stale (new fragments / due
 * windows); otherwise stable.
 */
export function getProjectionStatus(
  status: EntityStatus | undefined,
  hasPending: boolean,
): ProjectionStatusInfo {
  const entropy = status?.newFragmentIds?.length ?? 0;
  const blockedBy = status?.staleDependencies ?? [];
  const dueWindows = status?.pendingWindows?.length ?? 0;

  let kind: ProjectionStatus = "stable";
  if (hasPending) kind = "pending";
  else if (blockedBy.length > 0) kind = "blocked";
  else if (entropy > 0 || dueWindows > 0) kind = "stale";

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
