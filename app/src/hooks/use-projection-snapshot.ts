import { useMemo } from "react";

import type {
  ProjectionResponse,
  ProjectionSnapshotResponse,
} from "@/api/kalaidoscope/types";
import { useLiveCollection } from "@/hooks/use-live-collection";

/**
 * Decoded snapshot payload. The generator emits the LLM output as plain text
 * (decoded into `{ content }` by {@link parseProjectionOutput}); the shape stays
 * loose so older/structured snapshots still render off `content`.
 */
export interface ProjectionOutput {
  content?: string;
  [key: string]: unknown;
}

/**
 * What the detail view needs to render, as a discriminated union so the
 * component can exhaustively switch instead of juggling loose booleans:
 *
 * - `loading`  — first fetch, nothing cached yet.
 * - `empty`    — projection exists but has produced no snapshot.
 * - `ready`    — a live snapshot is available.
 * - `error`    — the snapshot or projection fetch failed.
 *
 * (A `regenerating` state is intentionally omitted for now — the backend has no
 * in-flight flag to drive it.)
 */
export type ProjectionSnapshotState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "ready";
      current: ProjectionSnapshotResponse;
      output: ProjectionOutput;
    }
  | { status: "error"; error: Error };

export interface UseProjectionSnapshotResult {
  state: ProjectionSnapshotState;
  projection: ProjectionResponse | undefined;
  /** Full snapshot history, newest first (for a timeline). */
  snapshots: ProjectionSnapshotResponse[];
  liveSnapshot: ProjectionSnapshotResponse | undefined;
}

/**
 * A snapshot is "live" when approved. The backend treats an empty status as
 * approved (see `synthesis.ApprovedStatusFilter`), so mirror that here.
 */
function isApprovedSnapshot(s: ProjectionSnapshotResponse): boolean {
  return !s.status || s.status === "approved";
}

/**
 * Live view of a projection's current snapshot.
 *
 * Subscribes (via {@link useLiveCollection}) to the projection's snapshots and
 * to the projection record itself, so snapshots created by the chat trigger
 * surface in the UI as they're generated — no manual refetch. The "current"
 * snapshot is the most recent approved one, falling back to the newest.
 */
export function useProjectionSnapshot(
  projectionId: string | undefined,
): UseProjectionSnapshotResult {
  const enabled = !!projectionId;

  const snapshotsQuery = useLiveCollection("projection_snapshot", {
    filter: projectionId ? `projection_id="${projectionId}"` : undefined,
    sort: "-created",
    enabled,
  });
  const projectionsQuery = useLiveCollection("projection", {
    filter: projectionId ? `id="${projectionId}"` : undefined,
    enabled,
  });

  const projection = projectionsQuery.records[0];
  const snapshots = snapshotsQuery.records;

  // Snapshots are newest-first, so the first approved one is the live snapshot.
  const liveSnapshot = useMemo(
    () => snapshots.find(isApprovedSnapshot),
    [snapshots],
  );

  const state = useMemo<ProjectionSnapshotState>(() => {
    const error = snapshotsQuery.error ?? projectionsQuery.error;
    if (error) return { status: "error", error };

    // Only "loading" before anything has resolved; once we have records, a
    // background revalidation shouldn't bounce the UI back to a spinner.
    if (
      (snapshotsQuery.isLoading || projectionsQuery.isLoading) &&
      snapshots.length === 0 &&
      !projection
    ) {
      return { status: "loading" };
    }

    if (snapshots.length === 0) return { status: "empty" };

    const current = liveSnapshot ?? snapshots[0];

    return {
      status: "ready",
      current,
      output: parseProjectionOutput(current.output),
    };
  }, [
    snapshots,
    projection,
    liveSnapshot,
    snapshotsQuery.isLoading,
    snapshotsQuery.error,
    projectionsQuery.isLoading,
    projectionsQuery.error,
  ]);

  return { state, projection, snapshots, liveSnapshot };
}

/**
 * Snapshot outputs are stored as a JSON-encoded string (see `pbutil.JSONString`
 * on the backend), so PocketBase hands us a string we still have to parse.
 * Tolerates an already-decoded object and falls back to treating the raw value
 * as the content rather than throwing.
 */
export function parseProjectionOutput(raw: unknown): ProjectionOutput {
  if (raw && typeof raw === "object") return raw as ProjectionOutput;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object")
        return parsed as ProjectionOutput;
    } catch {
      // not JSON — treat the string itself as the content
    }
    return { content: raw };
  }
  return {};
}
