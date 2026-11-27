import type { EntityStatus } from "@kalaido/client/kalaidoscope/freshness";

export type ProjectionStatus =
  | "stable"
  | "generating"
  | "pending"
  | "preparing"
  | "stale";

export interface ProjectionStatusInfo {
  status: ProjectionStatus;
  /** New in-context fragments since the live snapshot (the "entropy" count). */
  entropy: number;
  /** Direct upstream ids that have published newer approved output since the live snapshot. */
  staleDependencies: string[];
  candidateOutdated?: boolean;
  candidateEngaged?: boolean;
}

/**
 * Resolve a projection's headline status from the server's freshness status
 * (`EntityStatus` from `GET /api/reconcile`) combined with local snapshot state.
 * Precedence: a generation running right now (the server's claim row) trumps
 * everything; then a pending candidate to review; then a lens still being
 * prepared (nothing can generate yet); then stale (new fragments, due windows,
 * or a direct upstream that has published since); otherwise stable.
 */
export function getProjectionStatus(
  status: EntityStatus | undefined,
  hasPending: boolean,
  opts?: {
    /** A status='generating' claim row exists — a generation is in flight. */
    generating?: boolean;
    /** Committed, but current_lens_id is still empty (distillation pending). */
    lensMissing?: boolean;
  },
): ProjectionStatusInfo {
  const entropy = status?.newFragmentIds?.length ?? 0;
  const staleDependencies = status?.staleDependencies ?? [];
  const dueWindows =
    (status?.pendingWindows?.length ?? 0) + (status?.staleWindows?.length ?? 0);
  const candidate = status?.candidate;
  const candidateOutdated = candidate?.outdated ?? false;
  const candidateEngaged = candidate?.engaged ?? false;
  const isUntouchedOutdated =
    hasPending && candidateOutdated && !candidateEngaged;

  let kind: ProjectionStatus = "stable";
  if (opts?.generating) kind = "generating";
  else if (hasPending && !isUntouchedOutdated) kind = "pending";
  else if (opts?.lensMissing) kind = "preparing";
  else if (
    entropy > 0 ||
    dueWindows > 0 ||
    staleDependencies.length > 0 ||
    isUntouchedOutdated
  )
    kind = "stale";

  return {
    status: kind,
    entropy,
    staleDependencies,
    candidateOutdated,
    candidateEngaged,
  };
}

export function statusLabel(status: ProjectionStatus): string {
  switch (status) {
    case "stable":
      return "up to date";
    case "generating":
      return "generating";
    case "pending":
      return "review candidate";
    case "preparing":
      return "preparing";
    case "stale":
      return "stale";
  }
}
