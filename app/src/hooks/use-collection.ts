import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";

import type { CollectionResponses } from "@/api/kalaidoscope/types";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";

/** Any collection or view in the generated PocketBase schema. */
export type CollectionName = keyof CollectionResponses;

/**
 * Subset of PocketBase list params used to fetch (and cache-key) a collection.
 * Any combination of these produces a distinct SWR cache entry.
 */
export interface CollectionQuery {
  sort?: string;
  filter?: string;
  expand?: string;
  fields?: string;
  /**
   * Pause fetching while `false`. Useful when the query depends on something
   * that isn't ready yet (an id, a search term, …). The previously fetched
   * data — if any — stays in the cache.
   */
  enabled?: boolean;
}

export interface UseCollectionResult<T> extends SWRResponse<T[], Error> {
  /** `data ?? []` — handy when you always want an array to render. */
  records: T[];
}

/**
 * Fetch every record from a PocketBase collection (or view), cached with SWR.
 *
 * The row type is inferred straight from the collection name — no generic to
 * pass and no hand-written shape to keep in sync:
 *
 * ```ts
 * const { records, isLoading } = useCollection("view_stream", {
 *   sort: "-source_time,-created",
 * }); // records: ViewStreamResponse[]
 * ```
 *
 * Results are keyed by the active client + collection + query, so cached data
 * is automatically scoped to the open kalaidoscope and never leaks across them.
 * Mutating data elsewhere? Call the returned `mutate()` to revalidate.
 */
export function useCollection<N extends CollectionName>(
  collection: N,
  query: CollectionQuery = {},
  config?: SWRConfiguration<CollectionResponses[N][], Error>,
): UseCollectionResult<CollectionResponses[N]> {
  const client = useKalaidoscopeClient();
  const { enabled = true, ...params } = query;

  // A stable, serialisable key. Scoped by `baseURL` (each kalaidoscope runs on
  // its own client) so one scope's cache can never surface another's records.
  const key = enabled
    ? (["collection", client.baseURL, collection, params] as const)
    : null;

  const swr = useSWR<CollectionResponses[N][], Error>(
    key,
    () =>
      client.collection(collection).getFullList({
        ...params,
        // SWR owns deduping and revalidation, so disable PocketBase's
        // auto-cancellation — otherwise concurrent revalidations reject each
        // other as "autocancelled".
        requestKey: null,
      }),
    config,
  );

  return { ...swr, records: swr.data ?? [] };
}
