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
  /** Upstream projection/reflection ids whose output has moved on / is stale. */
  staleDependencies?: string[];
  /** Elapsed schedule windows awaiting generation (scheduled entities). */
  pendingWindows?: Window[];
}

export interface StatusResponse {
  statuses: EntityStatus[];
}

/**
 * Fetch the read-only staleness plan for the active kalaidoscope. Recomputed on
 * every call (no server-side session) — re-fetch after an approve to advance a
 * rotation queue.
 */
export async function getRotation(): Promise<Result<StatusResponse, Error>> {
  return withActiveClient((client) =>
    client.send<StatusResponse>("/api/rotation", { method: "GET" }),
  );
}
