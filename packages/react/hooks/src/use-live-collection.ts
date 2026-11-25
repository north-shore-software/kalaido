import type { CollectionResponses } from "@kalaido/client/kalaidoscope/types";
import { type LiveReadResult, useLiveRead } from "@kalaido/state/live";
import { useMemo } from "react";
import {
  type KalaidoscopeCollectionName,
  kalaidoscopeCollectionSource,
} from "#kalaidoscope-live";
import { useKalaidoscopeClient } from "#use-kalaidoscope-client";

export type CollectionName = KalaidoscopeCollectionName;

/**
 * Subset of PocketBase list params used to fetch (and cache-key) a collection.
 * Any combination of these produces a distinct live-read cache entry.
 */
export interface CollectionQuery {
  sort?: string;
  filter?: string;
  expand?: string;
  fields?: string;
  /**
   * Pause fetching while `false`. Useful when the query depends on something
   * that isn't ready yet (an id, a search term, …).
   */
  enabled?: boolean;
}

export interface UseLiveCollectionResult<R> extends LiveReadResult<R[]> {
  /** `data ?? []` — handy when you always want an array to render. */
  readonly records: R[];
}

/**
 * Fetch and stay live-subscribed to a PocketBase collection (or view) via
 * `@kalaido/state`'s shared ref-counted SSE hub and SWR cache.
 */
export function useLiveCollection<
  N extends KalaidoscopeCollectionName,
  R = CollectionResponses[N],
>(collection: N, query: CollectionQuery = {}): UseLiveCollectionResult<R> {
  return useLiveCollectionWatching(collection, [collection], query);
}

/**
 * {@link useLiveCollection} where realtime invalidation comes from collections
 * other than the one being read (required for SQL views such as `view_stream`).
 */
export function useLiveCollectionWatching<
  N extends KalaidoscopeCollectionName,
  R = CollectionResponses[N],
>(
  collection: N,
  watched: readonly KalaidoscopeCollectionName[],
  query: CollectionQuery = {},
): UseLiveCollectionResult<R> {
  const client = useKalaidoscopeClient();

  const result = useLiveRead<R[]>(
    kalaidoscopeCollectionSource<N, R>(client, collection, query, {
      watch: watched,
    }),
  );

  const records = useMemo<R[]>(() => result.data ?? [], [result.data]);

  return {
    ...result,
    records,
  };
}
