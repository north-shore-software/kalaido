import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

// Mirrors api.Window on the backend (status/EntityStatus).
export interface Window {
  start: string;
  end: string;
}

/**
 * Per-entity freshness, mirroring `api.EntityStatus` from `GET /api/rotation`.
 * An entity is fully up to date iff `upToDateSnapshotId` is set (and the other
 * deltas are empty). The endpoint returns one of these per projection and
 * reflection, already topologically sorted (dependencies before dependents).
 */
export interface EntityStatus {
  id: string;
  type: "projection" | "reflection";
  /** Set only when fully fresh — the live snapshot that is up to date. */
  upToDateSnapshotId?: string;
  /** Fragments the lens resolves to now but the live snapshot didn't consume. */
  newFragmentIds?: string[];
  /**
   * Upstreams that have published newer output than the live snapshot consumed.
   * Actionable now: regenerating picks their new output up.
   */
  staleDependencies?: string[];
  /**
   * Upstreams that are not themselves up to date. Not actionable yet —
   * regenerating would consume output that is about to be superseded.
   */
  blockedBy?: string[];
  /** Reflections: materialized windows with no approved snapshot yet. */
  pendingWindows?: Window[];
  /**
   * Reflections: windows whose approved snapshot predates fragments that now
   * fall inside them (a backdated import). Regenerating them picks those up.
   */
  staleWindows?: Window[];
  candidate?: CandidateStatus;
}

/** Why a candidate is outdated; mirrors `engine.Currency*` on the backend. */
export type CandidateOutdatedReason =
  | "new_fragments"
  | "context_changed"
  | "lens_changed"
  | "model_changed";

/**
 * A projection's pending candidate, as the plan sees it: whether it still
 * reflects what a generation would consume now, and whether the user has
 * invested in it (hand edits, chat proposals, an open refinement). The machine
 * never replaces an engaged candidate.
 */
export interface CandidateStatus {
  id: string;
  outdated: boolean;
  /** Set only when `outdated`. */
  reason?: CandidateOutdatedReason;
  engaged: boolean;
  /** In-scope fragments the candidate's resolved context never saw. */
  newFragmentIds?: string[];
}

export interface StatusResponse {
  statuses: EntityStatus[];
}

/** True when the entity has any outstanding delta — i.e. it needs action. */
export function hasDelta(s: EntityStatus): boolean {
  return (
    (s.newFragmentIds?.length ?? 0) > 0 ||
    (s.staleDependencies?.length ?? 0) > 0 ||
    (s.blockedBy?.length ?? 0) > 0 ||
    (s.pendingWindows?.length ?? 0) > 0 ||
    (s.staleWindows?.length ?? 0) > 0
  );
}

/**
 * True when the entity can be worked on right now: it has a delta and nothing
 * upstream is still pending. Callers walking the plan in its (topological)
 * order can take the first match as the next thing to do.
 */
export function isActionable(s: EntityStatus): boolean {
  return hasDelta(s) && (s.blockedBy?.length ?? 0) === 0;
}

/**
 * Fetch the read-only staleness plan for the active kalaidoscope. Recomputed on
 * every call (no server-side session) — re-fetch after an approve to advance a
 * rotation queue.
 */
export async function getRotation(): Promise<Result<StatusResponse, Error>> {
  return withActiveClient((client) =>
    client.send<StatusResponse>("/api/reconcile", { method: "GET" }),
  );
}
