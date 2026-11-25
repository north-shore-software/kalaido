import type { Result } from "neverthrow";

/** Opaque invalidation tag pairing external live reads with external writes. */
export type LiveTag = string;

export type LiveReadStatus = "loading" | "ready" | "error";

/**
 * Uniform caller-facing contract returned by `useLiveRead` regardless of the
 * backing store (PocketBase collection, computed PB endpoint, REST endpoint,
 * or reactive atom). No manual `refresh()` escape hatch is exposed — liveness
 * is owned by the source adapter and paired writes.
 */
export interface LiveReadResult<T> {
  readonly data: T | undefined;
  readonly status: LiveReadStatus;
  /** True only on the initial fetch before any data has arrived. */
  readonly isLoading: boolean;
  /** True during any in-flight fetch or background revalidation. */
  readonly isValidating: boolean;
  readonly error: Error | null;
}

export interface LiveOfflineCache<T> {
  readonly read: () => Promise<T | undefined>;
  readonly reconcile: (cached: T | undefined, fresh: T) => T;
  readonly write: (value: T) => Promise<void>;
}

export interface LiveSubscribeCallbacks<T> {
  /** Signal that the external store changed and SWR should revalidate. */
  readonly invalidate: () => void;
  /** Push an authoritative value directly into the SWR cache (atom sources). */
  readonly setData: (value: T) => void;
}

export interface LiveSource<T> {
  /** Stable serializable SWR cache key. `null` disables fetching and subscriptions. */
  readonly key: readonly unknown[] | null;
  /** Tags invalidated automatically by paired external writes. */
  readonly tags?: readonly LiveTag[];
  /** Fetches the authoritative value from the external store. */
  readonly fetch: () => Promise<Result<T, Error>>;
  /** Optional push channel; returns an unsubscribe function. */
  readonly subscribe?: (callbacks: LiveSubscribeCallbacks<T>) => () => void;
  /** Coalesce bursty `invalidate()` events into one revalidation (ms). */
  readonly coalesceMs?: number;
  /**
   * Optional offline local cache (reserved for the documented cloud-workspaces
   * exception): seeds cached data when offline and reconciles/writes on fetch.
   */
  readonly offlineCache?: LiveOfflineCache<T>;
  readonly revalidateOnFocus?: boolean;
  readonly revalidateOnReconnect?: boolean;
}

/**
 * Allowed return shapes for external writes:
 * - `void` for updates, deletes, and actions
 * - `{ id }` or `{ ids }` for creates
 * Full entity payloads are intentionally forbidden at the type level; updated
 * values always flow back through live reads.
 */
export type WriteReturn =
  // biome-ignore lint/suspicious/noConfusingVoidType: matches neverthrow Result<void, Error> returned by @kalaido/client mutations
  void | { readonly id: string } | { readonly ids: readonly string[] };

export type WriteStatus = "idle" | "pending" | "success" | "error";

export type WriteOutcome<TOut extends WriteReturn> =
  // biome-ignore lint/suspicious/noConfusingVoidType: matches default TOut = void for non-create mutations
  | ([TOut] extends [void]
      ? { readonly status: "success" }
      : { readonly status: "success" } & TOut)
  | { readonly status: "ignored" }
  | { readonly status: "error"; readonly error: Error };

export interface ExternalWriteDef<
  TArgs = void,
  TOut extends WriteReturn = void,
> {
  readonly execute: (args: TArgs) => Promise<Result<TOut, Error>>;
  /** Tags invalidated (and awaited) after `execute` succeeds. */
  readonly invalidates?:
    | readonly LiveTag[]
    | ((args: TArgs) => readonly LiveTag[]);
  /**
   * How overlapping calls while a write is already in flight are handled.
   * Defaults to `"ignore"`, which returns `{ status: "ignored" }` immediately.
   */
  readonly concurrency?: "ignore" | "allow";
}

export interface ExternalWriteHandle<TArgs, TOut extends WriteReturn> {
  readonly run: (
    // biome-ignore lint/suspicious/noConfusingVoidType: distinguishes zero-argument writes (TArgs = void) from parameterized writes
    ...args: [TArgs] extends [void] ? [] : [args: TArgs]
  ) => Promise<WriteOutcome<TOut>>;
  readonly status: WriteStatus;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly reset: () => void;
}
