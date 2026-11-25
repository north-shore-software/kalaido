import { err, ok, type Result } from "neverthrow";
import type PocketBase from "pocketbase";
import { unstable_serialize } from "swr";
import { toError } from "#errors";
import { clearLiveCache, type LiveSource, type LiveTag } from "#live";
import { subscribePbCollection } from "./subscription-hub";

export interface PbCollectionQuery {
  readonly sort?: string;
  readonly filter?: string;
  readonly expand?: string;
  readonly fields?: string;
  readonly enabled?: boolean;
}

export interface PbCollectionSourceOptions<
  TCollection extends string = string,
> {
  /**
   * Collections whose realtime events invalidate this query.
   * Defaults to `[collection]`. Required for SQL views which do not emit
   * realtime events of their own.
   */
  readonly watch?: readonly TCollection[];
  readonly coalesceMs?: number;
  readonly tags?: readonly LiveTag[];
}

export function pbCollectionTag(baseURL: string, collection: string): LiveTag {
  return `pb:${baseURL}:collection:${collection}`;
}

export function pbEndpointTag(baseURL: string, endpoint: string): LiveTag {
  return `pb:${baseURL}:endpoint:${endpoint}`;
}

function canonicalWatch<TCollection extends string>(
  watch: readonly TCollection[],
): TCollection[] {
  return [...new Set(watch)].sort() as TCollection[];
}

/**
 * PocketBase collection or SQL view live source.
 * Uses the shared ref-counted SSE hub so multiple mounted callers share one channel.
 */
export function pbCollectionSource<
  TRecord,
  TCollection extends string = string,
>(
  client: PocketBase,
  collection: TCollection,
  query: PbCollectionQuery = {},
  options: PbCollectionSourceOptions<TCollection> = {},
): LiveSource<TRecord[]> {
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
        const list = await client.collection(collection).getFullList<TRecord>({
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

export interface PbEndpointSourceOptions<
  T,
  TCollection extends string = string,
> {
  readonly client: PocketBase;
  /** Stable identifier for the endpoint. */
  readonly endpoint: string;
  readonly params?: readonly unknown[];
  readonly fetch: () => Promise<Result<T, Error>>;
  /** Underlying PocketBase collections whose mutations invalidate this endpoint. */
  readonly watch: readonly TCollection[];
  readonly tags?: readonly LiveTag[];
  readonly coalesceMs?: number;
  readonly enabled?: boolean;
}

/**
 * PocketBase computed HTTP endpoint live source.
 * Fetches via custom HTTP handler and revalidates when watched collections emit SSE events.
 */
export function pbEndpointSource<T, TCollection extends string = string>(
  options: PbEndpointSourceOptions<T, TCollection>,
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

/** Evict cached live reads scoped to a PocketBase instance `baseURL`. */
export function clearPocketBaseLiveCache(baseURL: string): Promise<void> {
  const serializedPrefix = unstable_serialize(["pb", baseURL]);
  return clearLiveCache(
    (k) => k[0] === "pb" && k[1] === baseURL,
    (s) => s.includes(baseURL) && s.startsWith(serializedPrefix.slice(0, 6)),
  );
}
