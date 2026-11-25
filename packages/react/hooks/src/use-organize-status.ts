import {
  getOrganizeStatus,
  type OrganizeStatus,
} from "@kalaido/client/kalaidoscope/organize";
import { useLiveRead } from "@kalaido/state/live";
import {
  type KalaidoscopeCollectionName,
  kalaidoscopeEndpointSource,
} from "#kalaidoscope-live";
import { useKalaidoscopeClient } from "#use-kalaidoscope-client";

/**
 * Collections whose changes can move the organise status. Snapshot rows are
 * the reconcile wave's footprint (claims, candidates), so `reconcile.running`
 * follows it.
 */
const WATCHED: readonly KalaidoscopeCollectionName[] = [
  "ingest",
  "kalaidoscope_map",
  "map_run",
  "discover_run",
  "fragment_annotation",
  "projection_snapshot",
  "reflection_snapshot",
  "colour",
  "colour_fragment",
];

/**
 * Annotation rows land in bursts (up to 100 concurrent), so coalesce a little
 * longer than `useLiveCollectionWatching` does before re-fetching.
 */
const COALESCE_MS = 300;

export interface UseOrganizeStatusResult {
  readonly status: OrganizeStatus | null;
  readonly isLoading: boolean;
  readonly isValidating: boolean;
  readonly error: Error | null;
}

/**
 * Fetches `GET /api/organize` via `@kalaido/state` and shares one ref-counted
 * PocketBase subscription set + SWR cache entry across all mounted consumers.
 */
export function useOrganizeStatus(): UseOrganizeStatusResult {
  const client = useKalaidoscopeClient();
  const result = useLiveRead(
    kalaidoscopeEndpointSource({
      client,
      endpoint: "status",
      watch: WATCHED,
      coalesceMs: COALESCE_MS,
      fetch: getOrganizeStatus,
    }),
  );

  return {
    status: result.data ?? null,
    isLoading: result.isLoading,
    isValidating: result.isValidating,
    error: result.error,
  };
}
