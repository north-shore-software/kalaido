import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

// Mirrors api.Window on the backend (EntityStatus).
export interface Window {
  start: string;
  end: string;
}

/**
 * Per-entity freshness, mirroring `api.EntityStatus` from `GET /api/reconcile`.
 * An entity is fully up to date iff `upToDateSnapshotId` is set (and the other
 * deltas are empty).
 */
export interface EntityStatus {
  id: string;
  type: "projection" | "reflection";
  /** Set only when fully fresh — the live snapshot that is up to date. */
  upToDateSnapshotId?: string;
  /** Fragments the lens resolves to now but the live snapshot didn't consume. */
  newFragmentIds?: string[];
  /**
   * Direct upstreams that have published newer approved output than the live
   * snapshot consumed. Regenerating picks their new output up.
   */
  staleDependencies?: string[];
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
 * A projection's pending candidate freshness: whether it still reflects what a
 * generation would consume now, and whether the user has invested in it (hand
 * edits, chat proposals, an open refinement).
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

export interface FreshnessStatusResponse {
  statuses: EntityStatus[];
}

/** True when the entity has any outstanding delta since its live snapshot. */
export function hasDelta(s: EntityStatus): boolean {
  return (
    (s.newFragmentIds?.length ?? 0) > 0 ||
    (s.staleDependencies?.length ?? 0) > 0 ||
    (s.pendingWindows?.length ?? 0) > 0 ||
    (s.staleWindows?.length ?? 0) > 0
  );
}

/**
 * Fetch the read-only freshness status for every active projection and
 * reflection in the active kalaidoscope.
 */
export async function getFreshnessStatus(): Promise<
  Result<FreshnessStatusResponse, Error>
> {
  return withActiveClient((client) =>
    client.send<FreshnessStatusResponse>("/api/reconcile", { method: "GET" }),
  );
}
