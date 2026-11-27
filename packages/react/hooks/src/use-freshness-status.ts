import {
  type EntityStatus,
  getFreshnessStatus,
} from "@kalaido/client/kalaidoscope/freshness";
import { useLiveRead } from "@kalaido/state/live";
import { useMemo } from "react";
import {
  type KalaidoscopeCollectionName,
  kalaidoscopeEndpointSource,
} from "#kalaidoscope-live";
import { useKalaidoscopeClient } from "#use-kalaidoscope-client";

const WATCHED: readonly KalaidoscopeCollectionName[] = [
  "fragment",
  "colour",
  "colour_fragment",
  "projection",
  "projection_snapshot",
  "projection_refinement",
  "reflection",
  "reflection_snapshot",
];

export interface UseFreshnessStatusResult {
  readonly statuses: EntityStatus[];
  readonly byId: Map<string, EntityStatus>;
  /** True until the first snapshot has arrived; refetches keep the previous one. */
  readonly isLoading: boolean;
  readonly isValidating: boolean;
  readonly error: Error | null;
}

/**
 * Fetches live entity freshness from `GET /api/reconcile` via `@kalaido/state`,
 * automatically revalidating when underlying collections change.
 */
export function useFreshnessStatus(): UseFreshnessStatusResult {
  const client = useKalaidoscopeClient();

  const result = useLiveRead(
    kalaidoscopeEndpointSource({
      client,
      endpoint: "reconcile",
      watch: WATCHED,
      fetch: getFreshnessStatus,
    }),
  );

  const statuses = useMemo<EntityStatus[]>(
    () => result.data?.statuses ?? [],
    [result.data],
  );

  const byId = useMemo(() => {
    const m = new Map<string, EntityStatus>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);

  return {
    statuses,
    byId,
    isLoading: result.isLoading,
    isValidating: result.isValidating,
    error: result.error,
  };
}
