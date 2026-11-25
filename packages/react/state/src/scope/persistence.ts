import { err, ok, type Result } from "neverthrow";
import { toError } from "#errors";

export type HydrationStatus = "pending" | "ready" | "error";

export interface ScopePersistenceAdapter<T extends Record<string, unknown>> {
  /** Load persisted keys once during explicit `hydrate()`. */
  readonly load: () => Promise<Result<Partial<T>, Error>>;
  /** Persist a changed key optimistically in the background. */
  readonly save: <K extends keyof T & string>(
    key: K,
    value: T[K],
  ) => Promise<Result<void, Error>>;
  /** Remove a persisted key when deleted or set to `undefined`. */
  readonly remove: <K extends keyof T & string>(
    key: K,
  ) => Promise<Result<void, Error>>;
}

export interface ScopePersistOptions<
  OwnS extends object,
  PKeys extends readonly (keyof OwnS & string)[] = readonly (keyof OwnS &
    string)[],
> {
  /** Subset of `OwnS` keys that write through transparently on change. */
  readonly keys: PKeys;
  /** Storage backing implementing load/save/remove. */
  readonly adapter: ScopePersistenceAdapter<Pick<OwnS, PKeys[number]>>;
  /**
   * Runs inside the guarded hydration transaction once `adapter.load()`
   * settles, before the outward view syncs — so callers can derive post-boot
   * state (e.g. `appStage`) without triggering write-through echoes.
   */
  readonly onHydrated?: (
    state: OwnS,
    result: Result<Partial<Pick<OwnS, PKeys[number]>>, Error>,
  ) => void;
  /** Non-fatal callback for background write failures (default: `console.error`). */
  readonly onWriteError?: (key: PKeys[number], error: Error) => void;
}

const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.getOwnPropertyDescriptor(obj, key) !== undefined;

export interface GenericPersistOptions {
  readonly keys: readonly string[];
  readonly adapter: ScopePersistenceAdapter<Record<string, unknown>>;
  readonly onHydrated?: (
    state: Record<string, unknown>,
    result: Result<Partial<Record<string, unknown>>, Error>,
  ) => void;
  readonly onWriteError?: (key: string, error: Error) => void;
}

type WriteOp = { kind: "save"; value: unknown } | { kind: "remove" };

interface KeyQueue {
  inFlight: Promise<void> | null;
  pending: WriteOp | null;
}

const ABSENT = Symbol("state.persist.absent");

export interface PersistenceController {
  readonly hydrate: (
    apply: (fn: (ownProxy: Record<string, unknown>) => void) => void,
    isDisposed: () => boolean,
  ) => Promise<Result<void, Error>>;
  readonly onOwnSync: (ownSnap: Record<string, unknown>) => void;
  readonly flush: () => Promise<void>;
  readonly stop: () => void;
  readonly getStatus: () => HydrationStatus;
  readonly updateCallbacks: (next: GenericPersistOptions | undefined) => void;
}

/**
 * Internal write-through & explicit-hydration controller for persisted scopes.
 *
 * Guarantees:
 * - Initial values are recorded as baseline so mounting never echoes defaults.
 * - `hydrate()` deduplicates concurrent calls, skips keys already dirtied by
 *   user dispatches before hydration resolved, and suppresses echo writes
 *   while applying loaded values + `onHydrated`.
 * - Subsequent mutations write optimistically in the background with per-key
 *   serialization + coalescing so rapid updates never arrive out of order.
 * - `stop()` stops observing new changes while already-queued writes finish.
 */
export function createPersistenceController(
  initialOptions: GenericPersistOptions,
  initialSnapshot: Record<string, unknown>,
): PersistenceController {
  let currentOptions = initialOptions;
  const persistedKeys = [...new Set(initialOptions.keys)];

  const lastSeen = new Map<string, unknown>();
  for (const key of persistedKeys) {
    const val = hasOwn(initialSnapshot, key) ? initialSnapshot[key] : undefined;
    lastSeen.set(key, val === undefined ? ABSENT : val);
  }

  const dirtyBeforeHydrate = new Set<string>();
  const queues = new Map<string, KeyQueue>();

  let status: HydrationStatus = "pending";
  let hydrating = false;
  let stopped = false;
  let inflightHydrate: Promise<Result<void, Error>> | null = null;

  const reportError = (key: string, error: Error) => {
    if (currentOptions.onWriteError) {
      currentOptions.onWriteError(key, error);
    } else {
      console.error(`useScope persist write failed for "${key}":`, error);
    }
  };

  const enqueue = (key: string, op: WriteOp) => {
    let q = queues.get(key);
    if (!q) {
      q = { inFlight: null, pending: null };
      queues.set(key, q);
    }
    q.pending = op;
    if (q.inFlight) return;

    const drain = async () => {
      while (q.pending) {
        const next = q.pending;
        q.pending = null;
        try {
          const res =
            next.kind === "save"
              ? await currentOptions.adapter.save(key, next.value)
              : await currentOptions.adapter.remove(key);
          if (res.isErr()) {
            reportError(key, res.error);
          }
        } catch (e) {
          reportError(key, toError(e));
        }
      }
      q.inFlight = null;
      queues.delete(key);
    };

    q.inFlight = drain();
  };

  const onOwnSync = (ownSnap: Record<string, unknown>) => {
    if (stopped || hydrating) return;

    for (const key of persistedKeys) {
      const hasVal = hasOwn(ownSnap, key) && ownSnap[key] !== undefined;
      const next = hasVal ? ownSnap[key] : ABSENT;
      const prev = lastSeen.get(key);
      if (Object.is(prev, next)) continue;

      lastSeen.set(key, next);
      if (status === "pending") {
        dirtyBeforeHydrate.add(key);
      }

      if (next === ABSENT) {
        enqueue(key, { kind: "remove" });
      } else {
        enqueue(key, { kind: "save", value: next });
      }
    }
  };

  const hydrate = (
    apply: (fn: (ownProxy: Record<string, unknown>) => void) => void,
    isDisposed: () => boolean,
  ): Promise<Result<void, Error>> => {
    if (inflightHydrate) return inflightHydrate;

    inflightHydrate = (async () => {
      let loadResult: Result<Partial<Record<string, unknown>>, Error>;
      try {
        loadResult = await currentOptions.adapter.load();
      } catch (e) {
        loadResult = err(toError(e));
      }

      if (stopped || isDisposed()) {
        return loadResult.isOk() ? ok(undefined) : err(loadResult.error);
      }

      hydrating = true;
      try {
        apply((ownProxy) => {
          if (loadResult.isOk()) {
            const loaded = loadResult.value;
            for (const key of persistedKeys) {
              if (dirtyBeforeHydrate.has(key)) continue;
              if (hasOwn(loaded, key) && loaded[key] !== undefined) {
                ownProxy[key] = loaded[key];
                lastSeen.set(key, loaded[key]);
              }
            }
          }
          currentOptions.onHydrated?.(ownProxy, loadResult);
        });
      } finally {
        hydrating = false;
      }

      if (loadResult.isErr()) {
        status = "error";
        inflightHydrate = null;
        return err(loadResult.error);
      }

      status = "ready";
      return ok(undefined);
    })();

    return inflightHydrate;
  };

  const flush = async (): Promise<void> => {
    while (queues.size > 0) {
      const pending = Array.from(queues.values())
        .map((q) => q.inFlight)
        .filter((p): p is Promise<void> => p !== null);
      if (pending.length === 0) break;
      await Promise.all(pending);
    }
  };

  return {
    hydrate,
    onOwnSync,
    flush,
    stop: () => {
      stopped = true;
    },
    getStatus: () => status,
    updateCallbacks: (next) => {
      if (next) currentOptions = next;
    },
  };
}
