import type { CollectionResponses } from "@kalaido/client/kalaidoscope/types";
import {
  invalidateLiveTags,
  type LiveReadResult,
  useLiveRead,
} from "@kalaido/state/live";
import { useCallback, useMemo } from "react";
import {
  type KalaidoscopeCollectionName,
  kalaidoscopeCollectionSource,
  kalaidoscopeCollectionTag,
} from "#kalaidoscope-live";
import type { CollectionQuery } from "#use-collection";
import { useKalaidoscopeClient } from "#use-kalaidoscope-client";

export type { CollectionQuery };
export type CollectionName = KalaidoscopeCollectionName;

export interface UseLiveCollectionResult<R> extends LiveReadResult<R[]> {
  /** `data ?? []` — handy when you always want an array to render. */
  readonly records: R[];
  /**
   * @deprecated Temporary Wave 1 bridge; removed in Wave 3 once all callers
   * drop manual `.mutate()` in favor of `useExternalWrite` tag invalidation.
   */
  readonly mutate: () => Promise<void>;
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
  const baseURL = client.baseURL;
  const watchedKey = watched.join("\0");

  const result = useLiveRead<R[]>(
    kalaidoscopeCollectionSource<N, R>(client, collection, query, {
      watch: watched,
    }),
  );

  const records = useMemo<R[]>(() => result.data ?? [], [result.data]);

  const mutate = useCallback(() => {
    const names = (
      watchedKey ? watchedKey.split("\0") : [collection]
    ) as KalaidoscopeCollectionName[];
    return invalidateLiveTags(
      names.map((name) => kalaidoscopeCollectionTag(baseURL, name)),
    );
  }, [baseURL, collection, watchedKey]);

  return {
    ...result,
    records,
    mutate,
  };
}
