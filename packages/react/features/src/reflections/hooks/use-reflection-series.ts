import type { ReflectionWindow } from "@kalaido/client/kalaidoscope/reflections";
import type {
  ReflectionResponse,
  ReflectionSnapshotResponse,
} from "@kalaido/client/kalaidoscope/types";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useMemo } from "react";
import { useReflectionWindows } from "./use-reflection-windows";

export interface ReflectionOutput {
  content?: string;
}

/** One window of the series with what the store holds for it. */
export interface SeriesWindow extends ReflectionWindow {
  /** The window's current approved snapshot, if any. */
  snapshot?: ReflectionSnapshotResponse;
  /** The snapshot was produced by a lens other than the reflection's current one. */
  olderLens: boolean;
}

/** The series key of a windowless (unscheduled) reflection's snapshots. */
export const ALL_TIME_KEY = "";

/**
 * A window's series key from its bounds. The served windows carry RFC3339
 * and snapshot records carry PocketBase's own `YYYY-MM-DD HH:mm:ss.sssZ`, so
 * both sides are normalised through Date before they are compared.
 */
function windowKey(start?: string, end?: string): string {
  if (!start || !end) return ALL_TIME_KEY;
  const iso = (s: string) => {
    const t = new Date(s.replace(" ", "T")).getTime();
    return Number.isNaN(t) ? s : new Date(t).toISOString();
  };
  return `${iso(start)}_${iso(end)}`;
}

/**
 * A reflection as a series of windows: the reflection record, its windows
 * (from `useReflectionWindows`), and each window's current approved snapshot
 * joined in by window bounds. Newest first. A reflection with no windows at
 * all (unscheduled, or legacy windowless snapshots) surfaces one "All time"
 * pseudo-window so its snapshots stay reachable.
 */
export function useReflectionSeries(reflectionId: string | undefined) {
  const enabled = !!reflectionId;
  const reflectionsQuery = useLiveCollection("reflection", {
    filter: reflectionId ? `id="${reflectionId}"` : undefined,
    enabled,
  });
  const snapshotsQuery = useLiveCollection("reflection_snapshot", {
    filter: reflectionId ? `reflection_id="${reflectionId}"` : undefined,
    sort: "-created",
    enabled,
  });
  const windowsQuery = useReflectionWindows(reflectionId);

  const reflection = reflectionsQuery.records[0] as
    | ReflectionResponse
    | undefined;
  const snapshots = snapshotsQuery.records as ReflectionSnapshotResponse[];
  const served = windowsQuery.windows;

  const approvedByKey = useMemo(() => {
    const map = new Map<string, ReflectionSnapshotResponse>();
    for (const s of snapshots) {
      if (s.status && s.status !== "approved") continue;
      const key = windowKey(s.window_start, s.window_end);
      const prev = map.get(key);
      if (
        !prev ||
        (s.approval_sequence_number ?? 0) > (prev.approval_sequence_number ?? 0)
      ) {
        map.set(key, s);
      }
    }
    return map;
  }, [snapshots]);

  const windows = useMemo<SeriesWindow[]>(() => {
    const currentLens = reflection?.current_lens_id ?? "";
    const join = (w: ReflectionWindow): SeriesWindow => {
      const snapshot = approvedByKey.get(windowKey(w.start, w.end));
      return {
        ...w,
        snapshot,
        olderLens: !!snapshot && (snapshot.lens_id ?? "") !== currentLens,
      };
    };
    const list = [...served].reverse().map(join);
    if (list.length === 0 && approvedByKey.has(ALL_TIME_KEY)) {
      list.push(
        join({
          id: "all-time",
          key: ALL_TIME_KEY,
          start: "",
          end: "",
          hasApproved: true,
          generating: snapshots.some(
            (s) => s.status === "generating" && !s.window_start,
          ),
          backfilled: false,
        }),
      );
    }
    return list;
  }, [served, approvedByKey, reflection, snapshots]);

  const loading =
    (reflectionsQuery.isLoading && !reflection) ||
    (enabled && windowsQuery.isLoading);

  return {
    reflection,
    windows,
    loading,
    error: reflectionsQuery.error ?? snapshotsQuery.error ?? windowsQuery.error,
  };
}

/** A snapshot's `output` column holds the generated markdown as plain text. */
export function parseReflectionOutput(raw: unknown): ReflectionOutput {
  return typeof raw === "string" ? { content: raw } : {};
}
