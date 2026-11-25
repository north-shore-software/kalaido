import type {
  CollectionResponses,
  TypedPocketBase,
} from "@kalaido/client/kalaidoscope/types";
import { toError } from "@kalaido/client/lib/errors";
import { err, ok, type Result } from "neverthrow";
import {
  type LiveCollectionName,
  subscribePbCollection,
} from "./pb-subscription-hub";
import type { LiveOfflineCache, LiveSource, LiveTag } from "./types";

export interface LiveCollectionQuery {
  readonly sort?: string;
  readonly filter?: string;
  readonly expand?: string;
  readonly fields?: string;
  readonly enabled?: boolean;
}

export interface PbCollectionSourceOptions {
  /**
   * Collections whose realtime events invalidate this query.
   * Defaults to `[collection]`. Required for SQL views (such as `view_stream`)
   * which do not emit realtime events of their own.
   */
  readonly watch?: readonly LiveCollectionName[];
  readonly coalesceMs?: number;
  readonly tags?: readonly LiveTag[];
}

export function pbCollectionTag(
  baseURL: string,
  collection: LiveCollectionName,
): LiveTag {
  return `pb:${baseURL}:collection:${collection}`;
}

export function pbEndpointTag(baseURL: string, endpoint: string): LiveTag {
  return `pb:${baseURL}:endpoint:${endpoint}`;
}

function canonicalWatch(
  watch: readonly LiveCollectionName[],
): LiveCollectionName[] {
  return [...new Set(watch)].sort() as LiveCollectionName[];
}

/**
 * Adapter 1: PocketBase collection or SQL view live source.
 * Uses `pbSubscriptionHub` so multiple mounted callers share one SSE channel.
 */
export function pbCollectionSource<
  N extends LiveCollectionName,
  R = CollectionResponses[N],
>(
  client: TypedPocketBase,
  collection: N,
  query: LiveCollectionQuery = {},
  options: PbCollectionSourceOptions = {},
): LiveSource<R[]> {
  const { enabled = true, ...params } = query;
  const watched = canonicalWatch(options.watch ?? [collection]);
  const coalesceMs = options.coalesceMs ?? 50;

  const tags: LiveTag[] = [
    ...watched.map((w) => pbCollectionTag(client.baseURL, w)),
    ...(options.tags ?? []),
  ];

  return {
    key: enabled
      ? ([
          "pb",
          client.baseURL,
          "collection",
          collection,
          params,
          watched,
        ] as const)
      : null,
    tags,
    coalesceMs,
    fetch: async () => {
      try {
        const list = await client.collection(collection).getFullList<R>({
          ...params,
          requestKey: null,
        });
        return ok(list);
      } catch (e) {
        return err(toError(e));
      }
    },
    subscribe: ({ invalidate }) => {
      const unsubs = watched.map((name) =>
        subscribePbCollection(
          client,
          name,
          invalidate,
          name === collection ? params.filter : undefined,
        ),
      );
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
  };
}

export interface PbEndpointSourceOptions<T> {
  readonly client: TypedPocketBase;
  /** Stable identifier for the endpoint (and optional params, e.g. reflection id). */
  readonly endpoint: string;
  readonly params?: readonly unknown[];
  readonly fetch: () => Promise<Result<T, Error>>;
  /** Underlying PocketBase collections whose mutations invalidate this computed endpoint. */
  readonly watch: readonly LiveCollectionName[];
  readonly tags?: readonly LiveTag[];
  readonly coalesceMs?: number;
  readonly enabled?: boolean;
}

/**
 * Adapter 2: PocketBase computed HTTP endpoint live source
 * (e.g. `/api/status`, `/api/reconcile`, `/api/reflections/:id/windows`,
 * `kalaidoscope_config`, `chat_conversation` summaries).
 */
export function pbEndpointSource<T>(
  options: PbEndpointSourceOptions<T>,
): LiveSource<T> {
  const {
    client,
    endpoint,
    params = [],
    fetch,
    watch,
    tags: extraTags = [],
    coalesceMs = 50,
    enabled = true,
  } = options;
  const watched = canonicalWatch(watch);

  const tags: LiveTag[] = [
    pbEndpointTag(client.baseURL, endpoint),
    ...watched.map((w) => pbCollectionTag(client.baseURL, w)),
    ...extraTags,
  ];

  return {
    key: enabled
      ? ([
          "pb",
          client.baseURL,
          "endpoint",
          endpoint,
          ...params,
          watched,
        ] as const)
      : null,
    tags,
    coalesceMs,
    fetch,
    subscribe:
      watched.length > 0
        ? ({ invalidate }) => {
            const unsubs = watched.map((name) =>
              subscribePbCollection(client, name, invalidate),
            );
            return () => {
              for (const unsub of unsubs) unsub();
            };
          }
        : undefined,
  };
}

export interface HttpLiveSourceOptions<T> {
  readonly key: readonly unknown[] | null;
  readonly tags?: readonly LiveTag[];
  readonly fetch: () => Promise<Result<T, Error>>;
  readonly offlineCache?: LiveOfflineCache<T>;
  readonly revalidateOnFocus?: boolean;
  readonly revalidateOnReconnect?: boolean;
}

/**
 * Adapter 3: Non-push HTTP / REST live source
 * (e.g. backups list, usage, quota, Cloud Registry workspaces with optional offline cache).
 * Updates via paired-write tag invalidation plus focus/reconnect revalidation.
 */
export function httpLiveSource<T>(
  options: HttpLiveSourceOptions<T>,
): LiveSource<T> {
  return {
    key: options.key,
    tags: options.tags,
    fetch: options.fetch,
    offlineCache: options.offlineCache,
    revalidateOnFocus: options.revalidateOnFocus ?? true,
    revalidateOnReconnect: options.revalidateOnReconnect ?? true,
  };
}

export interface AtomLiveSourceOptions<T> {
  readonly key: readonly unknown[] | null;
  readonly tags?: readonly LiveTag[];
  /** Synchronously read the current atom value. */
  readonly read: () => T;
  /** Subscribe to atom changes; returns an unsubscribe function. */
  readonly subscribe: (listener: (value: T) => void) => () => void;
  /** Optional explicit refetch invoked when invalidated by a paired write. */
  readonly refetch?: () => Promise<Result<T, Error>>;
}

/**
 * Adapter 4: Push/atom external store live source (e.g. Better Auth session atom).
 */
export function atomLiveSource<T>(
  options: AtomLiveSourceOptions<T>,
): LiveSource<T> {
  return {
    key: options.key,
    tags: options.tags,
    fetch: async () => {
      if (options.refetch) return options.refetch();
      return ok(options.read());
    },
    subscribe: ({ setData }) =>
      options.subscribe((value) => {
        setData(value);
      }),
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  };
}
