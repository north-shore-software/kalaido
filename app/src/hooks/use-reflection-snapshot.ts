import { useMemo } from "react";

import type {
  ReflectionResponse,
  ReflectionSnapshotResponse,
} from "@/api/kalaidoscope/types";
import { useLiveCollection } from "@/hooks/use-live-collection";

export interface ReflectionOutput {
  content?: string;
  [key: string]: unknown;
}

export type ReflectionSnapshotState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "ready";
      current: ReflectionSnapshotResponse;
      output: ReflectionOutput;
    }
  | { status: "error"; error: Error };

export interface UseReflectionSnapshotResult {
  state: ReflectionSnapshotState;
  reflection: ReflectionResponse | undefined;
  snapshots: ReflectionSnapshotResponse[];
  liveSnapshot: ReflectionSnapshotResponse | undefined;
}

/**
 * A snapshot is "live" when approved. The backend treats an empty status as
 * approved, so mirror that here. Reflections auto-approve, so the live snapshot
 * is normally just the newest one.
 */
function isApprovedSnapshot(s: ReflectionSnapshotResponse): boolean {
  return !s.status || s.status === "approved";
}

export function useReflectionSnapshot(
  reflectionId: string | undefined,
): UseReflectionSnapshotResult {
  const enabled = !!reflectionId;

  const snapshotsQuery = useLiveCollection("reflection_snapshot", {
    filter: reflectionId ? `reflection_id="${reflectionId}"` : undefined,
    sort: "-created",
    enabled,
  });
  const reflectionsQuery = useLiveCollection("reflection", {
    filter: reflectionId ? `id="${reflectionId}"` : undefined,
    enabled,
  });

  const reflection = reflectionsQuery.records[0];
  // A status='generating' row is the server's in-flight claim, not a snapshot:
  // it has no output yet and must never render as a document or timeline entry.
  const allRecords = snapshotsQuery.records;
  const snapshots = useMemo(
    () => allRecords.filter((s) => s.status !== "generating"),
    [allRecords],
  );

  // Snapshots are newest-first, so the first approved one is the live snapshot.
  const liveSnapshot = useMemo(
    () => snapshots.find(isApprovedSnapshot),
    [snapshots],
  );

  const state = useMemo<ReflectionSnapshotState>(() => {
    const error = snapshotsQuery.error ?? reflectionsQuery.error;
    if (error) return { status: "error", error };

    if (
      (snapshotsQuery.isLoading || reflectionsQuery.isLoading) &&
      snapshots.length === 0 &&
      !reflection
    ) {
      return { status: "loading" };
    }

    if (snapshots.length === 0) return { status: "empty" };

    const current = liveSnapshot ?? snapshots[0];

    return {
      status: "ready",
      current,
      output: parseReflectionOutput(current.output),
    };
  }, [
    snapshots,
    reflection,
    liveSnapshot,
    snapshotsQuery.isLoading,
    snapshotsQuery.error,
    reflectionsQuery.isLoading,
    reflectionsQuery.error,
  ]);

  return { state, reflection, snapshots, liveSnapshot };
}

export function parseReflectionOutput(raw: unknown): ReflectionOutput {
  if (raw && typeof raw === "object") return raw as ReflectionOutput;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object")
        return parsed as ReflectionOutput;
    } catch {
      // not JSON — treat the string itself as the content
    }
    return { content: raw };
  }
  return {};
}
