import { ok, type Result } from "neverthrow";
import type { LiveOfflineCache, LiveSource, LiveTag } from "./types";

export interface HttpLiveSourceOptions<T> {
  readonly key: readonly unknown[] | null;
  readonly tags?: readonly LiveTag[];
  readonly fetch: () => Promise<Result<T, Error>>;
  readonly offlineCache?: LiveOfflineCache<T>;
  readonly revalidateOnFocus?: boolean;
  readonly revalidateOnReconnect?: boolean;
}

/**
 * Non-push HTTP / REST live source.
 * Updates via paired-write tag invalidation plus focus/reconnect revalidation,
 * with optional local offline cache support.
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
 * Push/atom external store live source (e.g. auth session atom, store bridge).
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
