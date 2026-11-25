import type {
  CollectionResponses,
  TypedPocketBase,
} from "@kalaido/client/kalaidoscope/types";
import {
  clearLiveCache,
  type LiveSource,
  type LiveTag,
} from "@kalaido/state/live";
import {
  clearPocketBaseLiveCache,
  type PbCollectionQuery,
  type PbCollectionSourceOptions,
  pbCollectionSource,
  pbCollectionTag,
  type PbEndpointSourceOptions,
  pbEndpointSource,
  pbEndpointTag,
} from "@kalaido/state/pocketbase";
import type { Result } from "neverthrow";

export type KalaidoscopeCollectionName = keyof CollectionResponses;

/** Typed Kalaido wrapper over `@kalaido/state/pocketbase` `pbCollectionSource`. */
export function kalaidoscopeCollectionSource<
  N extends KalaidoscopeCollectionName,
  R = CollectionResponses[N],
>(
  client: TypedPocketBase,
  collection: N,
  query: PbCollectionQuery = {},
  options: PbCollectionSourceOptions<KalaidoscopeCollectionName> = {},
): LiveSource<R[]> {
  return pbCollectionSource<R, KalaidoscopeCollectionName>(
    client,
    collection,
    query,
    options,
  );
}

export interface KalaidoscopeEndpointSourceOptions<T>
  extends Omit<
    PbEndpointSourceOptions<T, KalaidoscopeCollectionName>,
    "client"
  > {
  readonly client: TypedPocketBase;
  readonly fetch: () => Promise<Result<T, Error>>;
}

/** Typed Kalaido wrapper over `@kalaido/state/pocketbase` `pbEndpointSource`. */
export function kalaidoscopeEndpointSource<T>(
  options: KalaidoscopeEndpointSourceOptions<T>,
): LiveSource<T> {
  return pbEndpointSource<T, KalaidoscopeCollectionName>(options);
}

export function kalaidoscopeCollectionTag(
  baseURL: string,
  collection: KalaidoscopeCollectionName,
): LiveTag {
  return pbCollectionTag(baseURL, collection);
}

export const kalaidoscopeEndpointTag = pbEndpointTag;

/** Evict cached live reads scoped to a Kalaidoscope workspace `baseURL`. */
export const clearWorkspaceLiveCache = clearPocketBaseLiveCache;

/** Evict cached live reads scoped to Kalaido cloud account state (sign-out). */
export function clearCloudLiveCache(): Promise<void> {
  return clearLiveCache(
    (k) => k[0] === "cloud",
    (s) => s.includes('"cloud"'),
  );
}
