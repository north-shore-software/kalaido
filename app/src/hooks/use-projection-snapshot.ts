import { useMemo } from "react";

import type {
  ProjectionResponse,
  ProjectionSnapshotResponse,
} from "@/api/kalaidoscope/types";
import { useLiveCollection } from "@/hooks/use-live-collection";

/** Snapshot payload: the generated markdown, wrapped by {@link parseProjectionOutput}. */
export interface ProjectionOutput {
  content?: string;
}

/**
 * What the detail view needs to render, as a discriminated union so the
 * component can exhaustively switch instead of juggling loose booleans:
 *
 * - `loading`  — first fetch, nothing cached yet.
 * - `missing`  — the fetch settled and there is no such live projection
 *                (never existed, or soft-deleted). The page should leave.
 * - `empty`    — projection exists but has produced no snapshot.
 * - `ready`    — a live snapshot is available.
 * - `error`    — the snapshot or projection fetch failed.
 *
 * (An in-flight generation is reported via the separate `generating` flag,
 * driven by the server's status='generating' claim row.)
 */
export type ProjectionSnapshotState =
  | { status: "loading" }
  | { status: "missing" }
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
  /** A generation is running server-side (a status='generating' claim row). */
  generating: boolean;
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
  // A status='generating' row is the server's in-flight claim, not a snapshot:
  // it has no output yet and must never render as a document or timeline entry.
  const allRecords = snapshotsQuery.records;
  const snapshots = useMemo(
    () => allRecords.filter((s) => s.status !== "generating"),
    [allRecords],
  );
  const generating = allRecords.some((s) => s.status === "generating");

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

    // Settled with no live record: gone, or soft-deleted under us. Checked
    // before `empty` so a deleted projection never reads as "no snapshots".
    if (
      !projectionsQuery.isLoading &&
      (!projection || !!projection.deleted_at)
    ) {
      return { status: "missing" };
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

  return { state, projection, snapshots, liveSnapshot, generating };
}

/** A snapshot's `output` column holds the generated markdown as plain text. */
export function parseProjectionOutput(raw: unknown): ProjectionOutput {
  return typeof raw === "string" ? { content: raw } : {};
}
