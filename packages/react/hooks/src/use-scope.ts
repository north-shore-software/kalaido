import type { Result } from "neverthrow";
import { useEffect, useLayoutEffect, useRef } from "react";
import { proxy, type Snapshot, snapshot, subscribe } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  createPersistenceController,
  type GenericPersistOptions,
  type HydrationStatus,
  type PersistenceController,
  type ScopePersistenceAdapter,
  type ScopePersistOptions,
} from "#scope-persistence";

export type { HydrationStatus, ScopePersistenceAdapter, ScopePersistOptions };

export type ScopeEvent = { readonly type: string };

const SCOPE_META = Symbol("kalaido.scopeMeta");

interface ScopeMeta {
  /**
   * Allowed state keys on this scope:
   * - `null` when the scope owns open-ended state (`initial` was provided), so
   *   optional keys omitted from `initial()` remain narrowable by children.
   * - `ReadonlySet<string>` when the scope is purely narrowed (`from` without
   *   `initial`), strictly enforcing the narrowed whitelist at runtime.
   */
  readonly keys: ReadonlySet<string> | null;
  readonly events: ReadonlySet<string>;
}

/**
 * Read-only reactive state paired with its owner's event dispatcher.
 *
 * - Read state in React with {@link useScopeState} (or Valtio's `useSnapshot(handle.state)`).
 * - Trigger mutations via `await handle.dispatch(event)`.
 * - Direct writes to `handle.state` are rejected at both compile time and runtime.
 */
export interface StateHandle<
  S extends object = Record<never, never>,
  E extends ScopeEvent = never,
> {
  readonly state: Snapshot<S>;
  readonly dispatch: (event: E) => Promise<void>;
}

/** A persisted state handle created inside React, with explicit hydration. */
export interface PersistedStateHandle<
  S extends object = Record<never, never>,
  E extends ScopeEvent = never,
> extends StateHandle<S, E> {
  readonly hydrate: () => Promise<Result<void, Error>>;
  readonly flush: () => Promise<void>;
  readonly getHydrationStatus: () => HydrationStatus;
}

/** A root or derived scope created outside React, with explicit cleanup. */
export interface ScopeInstance<
  S extends object = Record<never, never>,
  E extends ScopeEvent = never,
> extends StateHandle<S, E> {
  readonly dispose: () => void;
}

/** A persisted scope created outside React, with explicit hydration and cleanup. */
export interface PersistedScopeInstance<
  S extends object = Record<never, never>,
  E extends ScopeEvent = never,
> extends ScopeInstance<S, E>,
    PersistedStateHandle<S, E> {}

/** Context passed as the optional 3rd argument to own event handlers. */
export interface ScopeHandlerContext<
  ParentS extends object = Record<never, never>,
  ParentE extends ScopeEvent = never,
> {
  /** Synchronous read-only snapshot of the state forwarded from `from`. */
  readonly parent: Snapshot<ParentS>;
  /** Dispatch one of the events forwarded from `from`. */
  readonly dispatchParent: (event: ParentE) => Promise<void>;
}

/**
 * Explicit handler map type for callers that pre-declare an event union `E`.
 * Ensures every event type in `E` has a matching handler.
 */
export type ScopeHandlers<
  OwnS extends object,
  OwnE extends ScopeEvent,
  ParentS extends object = Record<never, never>,
  ParentE extends ScopeEvent = never,
> = {
  [K in OwnE["type"]]: (
    state: OwnS,
    event: Extract<OwnE, { readonly type: K }>,
    ctx: ScopeHandlerContext<ParentS, ParentE>,
  ) => void | Promise<void>;
};

type AnyOwnHandlers<
  OwnS extends object,
  ParentS extends object,
  ParentE extends ScopeEvent,
> = {
  [K in string]: (
    state: OwnS,
    event: never,
    ctx: ScopeHandlerContext<ParentS, ParentE>,
  ) => void | Promise<void>;
};

type EventForHandler<K extends string, Fn> = Fn extends (
  state: never,
  event: infer E,
  ...rest: never[]
) => unknown
  ? [E] extends [never]
    ? { readonly type: K }
    : unknown extends E
      ? { readonly type: K }
      : [E] extends [{ readonly type: K }]
        ? E
        : never
  : { readonly type: K };

type InferHandlerEvents<H> = {
  [K in keyof H & string]: EventForHandler<K, H[K]>;
}[keyof H & string];

type InvalidHandlerKeys<H> = {
  [K in keyof H & string]: H[K] extends (
    state: never,
    event: infer E,
    ...rest: never[]
  ) => unknown
    ? [E] extends [never]
      ? never
      : unknown extends E
        ? never
        : [E] extends [{ readonly type: K }]
          ? never
          : K
    : never;
}[keyof H & string];

type ValidHandlerEvents<H> = [InvalidHandlerKeys<H>] extends [never]
  ? unknown
  : {
      readonly handlers?: {
        readonly [K in InvalidHandlerKeys<H>]?: never;
      };
    };

type ForbidKeys<Keys extends PropertyKey> = {
  [K in Keys]?: never;
};

type UnwrapState<H> = H extends StateHandle<infer S, never> ? S : never;
type UnwrapEvent<H> = H extends {
  readonly dispatch: (event: infer E) => Promise<void>;
}
  ? [E] extends [ScopeEvent]
    ? E
    : never
  : never;

type AnyStateHandle = StateHandle<object, never>;

type EmptyState = Record<never, never>;

type PickedState<
  ParentS extends object,
  SKeys extends readonly (keyof ParentS & string)[],
> = [SKeys[number]] extends [never] ? EmptyState : Pick<ParentS, SKeys[number]>;

type PickedEvents<
  ParentE extends ScopeEvent,
  ETypes extends readonly ParentE["type"][],
> = [ETypes[number]] extends [never]
  ? never
  : Extract<ParentE, { readonly type: ETypes[number] }>;

type MergeState<A extends object, B extends object> = [keyof A] extends [never]
  ? B
  : [keyof B] extends [never]
    ? A
    : A & B;

export interface OwnScopeOptions<
  OwnS extends object,
  H extends AnyOwnHandlers<NoInfer<OwnS>, EmptyState, never>,
  PKeys extends readonly (keyof OwnS & string)[] = never,
  P extends ScopePersistOptions<NoInfer<OwnS>, PKeys> | undefined = undefined,
> {
  readonly from?: undefined;
  readonly initial: () => OwnS;
  readonly handlers?: H & AnyOwnHandlers<NoInfer<OwnS>, EmptyState, never>;
  readonly persist?: P;
}

export interface NarrowScopeOptions<
  From extends AnyStateHandle,
  SKeys extends readonly (keyof UnwrapState<From> & string)[] = readonly [],
  ETypes extends readonly UnwrapEvent<From>["type"][] = readonly [],
> {
  readonly from: From;
  readonly state?: SKeys;
  readonly events?: ETypes;
  readonly initial?: undefined;
  readonly handlers?: undefined;
  readonly persist?: undefined;
}

type NoEventCollision<H, Forbidden extends string> = [
  Extract<keyof H, Forbidden>,
] extends [never]
  ? unknown
  : {
      readonly handlers?: {
        readonly [K in Extract<keyof H, Forbidden>]?: never;
      };
    };

export interface ExtendScopeOptions<
  From extends AnyStateHandle,
  SKeys extends readonly (keyof UnwrapState<From> & string)[] = readonly [],
  ETypes extends readonly UnwrapEvent<From>["type"][] = readonly [],
  OwnS extends object & ForbidKeys<SKeys[number]> = EmptyState,
  H extends AnyOwnHandlers<
    NoInfer<OwnS>,
    NoInfer<PickedState<UnwrapState<From>, SKeys>>,
    NoInfer<PickedEvents<UnwrapEvent<From>, ETypes>>
  > = Record<never, never>,
  PKeys extends readonly (keyof OwnS & string)[] = never,
  P extends ScopePersistOptions<NoInfer<OwnS>, PKeys> | undefined = undefined,
> {
  readonly from: From;
  readonly state?: SKeys;
  readonly events?: ETypes;
  readonly initial: () => OwnS;
  readonly handlers?: H &
    AnyOwnHandlers<
      NoInfer<OwnS>,
      NoInfer<PickedState<UnwrapState<From>, SKeys>>,
      NoInfer<PickedEvents<UnwrapEvent<From>, ETypes>>
    >;
  readonly persist?: P;
}

type ScopeReturn<S extends object, E extends ScopeEvent, P> = [P] extends [
  undefined,
]
  ? ScopeInstance<S, E>
  : PersistedScopeInstance<S, E>;

type UseScopeReturn<S extends object, E extends ScopeEvent, P> = [P] extends [
  undefined,
]
  ? StateHandle<S, E>
  : PersistedStateHandle<S, E>;

type InternalHandle = StateHandle<Record<string, unknown>, ScopeEvent> & {
  [SCOPE_META]?: ScopeMeta;
  readonly hydrate?: () => Promise<Result<void, Error>>;
  readonly flush?: () => Promise<void>;
  readonly getHydrationStatus?: () => HydrationStatus;
};

interface InternalScope<S extends object, E extends ScopeEvent> {
  readonly handle: StateHandle<S, E>;
  readonly attach: () => () => void;
  readonly dispose: () => void;
  readonly hydrate?: () => Promise<Result<void, Error>>;
  readonly flush?: () => Promise<void>;
  readonly getHydrationStatus?: () => HydrationStatus;
  setHandlers: (handlers: Record<string, GenericHandler> | undefined) => void;
  setPersistCallbacks: (persist: GenericPersistOptions | undefined) => void;
}

type GenericHandler = (
  state: Record<string, unknown>,
  event: ScopeEvent,
  ctx: ScopeHandlerContext<Record<string, unknown>, ScopeEvent>,
) => void | Promise<void>;

const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.getOwnPropertyDescriptor(obj, key) !== undefined;

function isPlainObjectOrArray(
  value: unknown,
): value is Record<PropertyKey, unknown> | unknown[] {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deeply freeze plain objects and arrays (without wrapping in Valtio `ref`),
 * preserving nested `useSnapshot` path tracking while leaving non-plain
 * instances (`Uint8Array`, `Date`, `Map`, `Set`, `AbortController`, etc.) and
 * getter properties untouched.
 */
function freezePlain<T>(value: T): T {
  if (!isPlainObjectOrArray(value) || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (desc && "value" in desc) {
      freezePlain(desc.value);
    }
  }
  return value;
}

function canonicalSig(items: readonly string[]): string {
  return JSON.stringify([...new Set(items)].sort());
}

function getScopeMeta(handle: InternalHandle): ScopeMeta | undefined {
  return handle[SCOPE_META];
}

function buildInternalScope(options: {
  from?: InternalHandle;
  stateKeys: readonly string[];
  eventTypes: readonly string[];
  ownEventNames?: readonly string[];
  initial?: () => Record<string, unknown>;
  handlers?: Record<string, GenericHandler>;
  persist?: GenericPersistOptions;
}): InternalScope<Record<string, unknown>, ScopeEvent> {
  const { from, stateKeys, eventTypes, initial } = options;
  let currentHandlers = options.handlers;

  const parentKeySet = new Set(stateKeys);
  const parentEventSet = new Set(eventTypes);

  if (from) {
    const parentMeta = getScopeMeta(from);
    if (parentMeta) {
      if (parentMeta.keys !== null) {
        for (const k of parentKeySet) {
          if (!parentMeta.keys.has(k)) {
            throw new Error(
              `Cannot narrow state key "${k}": not exposed by parent scope.`,
            );
          }
        }
      }
      for (const e of parentEventSet) {
        if (!parentMeta.events.has(e)) {
          throw new Error(
            `Cannot narrow event "${e}": not permitted by parent scope.`,
          );
        }
      }
    }
  }

  const hasOwnState = initial !== undefined;
  const ownInitial = initial ? initial() : undefined;
  if (ownInitial) {
    for (const k of Object.keys(ownInitial)) {
      if (parentKeySet.has(k)) {
        throw new Error(
          `Scope state key "${k}" collides with forwarded parent state key.`,
        );
      }
    }
  }

  const ownEventNames =
    options.ownEventNames ??
    (currentHandlers ? Object.keys(currentHandlers) : []);
  const ownEventSet = new Set(ownEventNames);

  for (const e of ownEventSet) {
    if (parentEventSet.has(e)) {
      throw new Error(
        `Scope event "${e}" collides with forwarded parent event.`,
      );
    }
  }

  const ownProxy = ownInitial
    ? proxy<Record<string, unknown>>(ownInitial)
    : null;

  const persistence: PersistenceController | null =
    ownProxy && options.persist
      ? createPersistenceController(
          options.persist,
          snapshot(ownProxy) as Record<string, unknown>,
        )
      : null;

  const syncedParentKeys = new Set<string>();
  const syncedOwnKeys = new Set<string>();
  const lastSyncedValues = new Map<string, unknown>();

  // Build the outward-facing read-only view proxy synchronously so first render
  // sees initial values immediately.
  const viewInit: Record<string, unknown> = {};
  if (from && parentKeySet.size > 0) {
    const parentSnap = snapshot(from.state) as Record<string, unknown>;
    for (const k of parentKeySet) {
      if (hasOwn(parentSnap, k)) {
        const raw = parentSnap[k];
        syncedParentKeys.add(k);
        lastSyncedValues.set(k, raw);
        viewInit[k] = freezePlain(raw);
      }
    }
  }
  if (ownProxy) {
    const ownSnap = snapshot(ownProxy) as Record<string, unknown>;
    for (const k of Object.keys(ownSnap)) {
      const raw = ownSnap[k];
      syncedOwnKeys.add(k);
      lastSyncedValues.set(k, raw);
      viewInit[k] = freezePlain(raw);
    }
  }

  const viewProxy = proxy<Record<string, unknown>>(viewInit);
  const allAllowedEvents = new Set([...parentEventSet, ...ownEventSet]);
  const allowedMetaKeys: ReadonlySet<string> | null = hasOwnState
    ? null
    : new Set(parentKeySet);

  let syncing = false;
  let attached = false;
  let disposed = false;
  let batchDepth = 0;
  let ownDirty = false;
  let cleaningCollision = false;

  const syncParent = () => {
    if (!from || parentKeySet.size === 0 || disposed) return;
    syncing = true;
    try {
      const parentSnap = snapshot(from.state) as Record<string, unknown>;
      for (const k of parentKeySet) {
        if (hasOwn(parentSnap, k)) {
          const raw = parentSnap[k];
          if (
            !syncedParentKeys.has(k) ||
            !Object.is(lastSyncedValues.get(k), raw)
          ) {
            syncedParentKeys.add(k);
            lastSyncedValues.set(k, raw);
            viewProxy[k] = freezePlain(raw);
          }
        } else if (syncedParentKeys.has(k)) {
          syncedParentKeys.delete(k);
          lastSyncedValues.delete(k);
          delete viewProxy[k];
        }
      }
    } finally {
      syncing = false;
    }
  };

  const syncOwn = () => {
    if (!ownProxy || disposed || cleaningCollision) return;
    const ownSnap = snapshot(ownProxy) as Record<string, unknown>;
    const currentKeys = new Set(Object.keys(ownSnap));

    for (const k of currentKeys) {
      if (parentKeySet.has(k)) {
        cleaningCollision = true;
        try {
          delete ownProxy[k];
        } finally {
          cleaningCollision = false;
        }
        throw new Error(
          `Scope state key "${k}" collides with forwarded parent state key.`,
        );
      }
    }

    syncing = true;
    try {
      for (const prevKey of syncedOwnKeys) {
        if (!currentKeys.has(prevKey)) {
          syncedOwnKeys.delete(prevKey);
          lastSyncedValues.delete(prevKey);
          delete viewProxy[prevKey];
        }
      }
      for (const k of currentKeys) {
        const raw = ownSnap[k];
        if (!syncedOwnKeys.has(k) || !Object.is(lastSyncedValues.get(k), raw)) {
          syncedOwnKeys.add(k);
          lastSyncedValues.set(k, raw);
          viewProxy[k] = freezePlain(raw);
        }
      }
    } finally {
      syncing = false;
    }

    persistence?.onOwnSync(ownSnap);
  };

  // Subscribe `ownProxy` for the life of this scope (no external leak since
  // `ownProxy` and `viewProxy` share the exact same owner lifetime).
  const unsubOwn = ownProxy
    ? subscribe(
        ownProxy,
        () => {
          if (disposed || cleaningCollision) return;
          if (batchDepth > 0) {
            ownDirty = true;
            return;
          }
          syncOwn();
        },
        true,
      )
    : null;

  // Guard `viewProxy` against direct external mutations at runtime (even via `as any`).
  subscribe(
    viewProxy,
    () => {
      if (syncing) return;
      syncing = true;
      try {
        const validKeys = new Set<PropertyKey>([
          ...syncedParentKeys,
          ...syncedOwnKeys,
        ]);
        for (const key of Reflect.ownKeys(viewProxy)) {
          if (!validKeys.has(key)) {
            delete (viewProxy as Record<PropertyKey, unknown>)[key];
          }
        }
        if (from && parentKeySet.size > 0) {
          const parentSnap = snapshot(from.state) as Record<string, unknown>;
          for (const k of parentKeySet) {
            if (hasOwn(parentSnap, k)) {
              const raw = parentSnap[k];
              syncedParentKeys.add(k);
              lastSyncedValues.set(k, raw);
              viewProxy[k] = freezePlain(raw);
            } else {
              syncedParentKeys.delete(k);
              lastSyncedValues.delete(k);
              delete viewProxy[k];
            }
          }
        }
        if (ownProxy) {
          const ownSnap = snapshot(ownProxy) as Record<string, unknown>;
          for (const k of Object.keys(ownSnap)) {
            if (!parentKeySet.has(k)) {
              const raw = ownSnap[k];
              syncedOwnKeys.add(k);
              lastSyncedValues.set(k, raw);
              viewProxy[k] = freezePlain(raw);
            }
          }
        }
      } finally {
        syncing = false;
      }
      throw new TypeError(
        "Cannot mutate StateHandle.state directly; dispatch an event instead.",
      );
    },
    true,
  );

  const readParentSnapshot = (): Snapshot<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    if (from && parentKeySet.size > 0) {
      const parentSnap = snapshot(from.state) as Record<string, unknown>;
      for (const k of parentKeySet) {
        if (hasOwn(parentSnap, k)) {
          out[k] = parentSnap[k];
        }
      }
    }
    return Object.freeze(out) as Snapshot<Record<string, unknown>>;
  };

  const dispatchParent = async (event: ScopeEvent): Promise<void> => {
    if (disposed) {
      throw new Error("Cannot dispatch on a disposed scope.");
    }
    if (!from || !parentEventSet.has(event.type)) {
      throw new Error(
        `Event "${event.type}" is not permitted on this scope handle.`,
      );
    }
    try {
      await from.dispatch(event);
    } finally {
      if (!attached && !disposed) {
        syncParent();
      }
    }
  };

  const dispatch = async (event: ScopeEvent): Promise<void> => {
    if (disposed) {
      throw new Error("Cannot dispatch on a disposed scope.");
    }

    if (ownEventSet.has(event.type)) {
      const handler = currentHandlers?.[event.type];
      if (!handler || !ownProxy) {
        throw new Error(
          `No handler registered for owned event "${event.type}".`,
        );
      }
      const ctx: ScopeHandlerContext<Record<string, unknown>, ScopeEvent> = {
        get parent() {
          return readParentSnapshot();
        },
        dispatchParent,
      };

      batchDepth += 1;
      let result: void | Promise<void>;
      try {
        result = handler(ownProxy, event, ctx);
      } finally {
        batchDepth -= 1;
        if (batchDepth === 0 && ownDirty && !disposed) {
          ownDirty = false;
          syncOwn();
        }
      }
      await result;
      return;
    }

    if (from && parentEventSet.has(event.type)) {
      try {
        await from.dispatch(event);
      } finally {
        if (!attached && !disposed) {
          syncParent();
        }
      }
      return;
    }

    throw new Error(
      `Event "${event.type}" is not permitted on this scope handle.`,
    );
  };

  let detachCurrent: (() => void) | null = null;

  const attach = (): (() => void) => {
    if (disposed) return () => {};
    detachCurrent?.();

    const unsubs: (() => void)[] = [];
    attached = true;

    if (from && parentKeySet.size > 0) {
      unsubs.push(
        subscribe(
          from.state,
          () => {
            syncParent();
          },
          true,
        ),
      );
      // Catch-up sync in case parent mutated between render and commit.
      syncParent();
    }

    if (ownProxy) {
      syncOwn();
    }

    const detach = () => {
      if (detachCurrent === detach) {
        detachCurrent = null;
      }
      attached = false;
      for (const unsub of unsubs) unsub();
    };
    detachCurrent = detach;
    return detach;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    persistence?.stop();
    detachCurrent?.();
    detachCurrent = null;
    unsubOwn?.();
  };

  const hydrate =
    persistence && ownProxy
      ? () =>
          persistence.hydrate(
            (applyFn) => {
              batchDepth += 1;
              try {
                applyFn(ownProxy);
              } finally {
                batchDepth -= 1;
                ownDirty = false;
                if (!disposed) {
                  syncOwn();
                }
              }
            },
            () => disposed,
          )
      : undefined;

  const flush = persistence ? () => persistence.flush() : undefined;
  const getHydrationStatus = persistence
    ? () => persistence.getStatus()
    : undefined;

  const handle: InternalHandle = Object.freeze({
    state: viewProxy as Snapshot<Record<string, unknown>>,
    dispatch,
    ...(hydrate ? { hydrate, flush, getHydrationStatus } : {}),
    [SCOPE_META]: {
      keys: allowedMetaKeys,
      events: allAllowedEvents,
    },
  });

  return {
    handle,
    attach,
    dispose,
    hydrate,
    flush,
    getHydrationStatus,
    setHandlers: (next) => {
      currentHandlers = next;
    },
    setPersistCallbacks: (next) => {
      persistence?.updateCallbacks(next);
    },
  };
}

/**
 * Subscribe a React component to the tracked fields read from `scope.state`.
 */
export function useScopeState<S extends object>(
  scope: StateHandle<S, never>,
  options?: { readonly sync?: boolean },
): Snapshot<S> {
  return useSnapshot(scope.state as S, options);
}

/**
 * Create a state scope outside React (e.g. app root).
 * Supports owning state, narrowing a parent scope, or both.
 */
export function createScope<
  OwnS extends object,
  H extends AnyOwnHandlers<NoInfer<OwnS>, EmptyState, never> = Record<
    never,
    never
  >,
  const PKeys extends readonly (keyof OwnS & string)[] = never,
  P extends ScopePersistOptions<NoInfer<OwnS>, PKeys> | undefined = undefined,
>(
  options: OwnScopeOptions<OwnS, H, PKeys, P> & ValidHandlerEvents<H>,
): ScopeReturn<OwnS, InferHandlerEvents<H>, P>;

export function createScope<
  From extends AnyStateHandle,
  const SKeys extends readonly (keyof UnwrapState<From> &
    string)[] = readonly [],
  const ETypes extends readonly UnwrapEvent<From>["type"][] = readonly [],
>(
  options: NarrowScopeOptions<From, SKeys, ETypes>,
): ScopeInstance<
  PickedState<UnwrapState<From>, SKeys>,
  PickedEvents<UnwrapEvent<From>, ETypes>
>;

export function createScope<
  From extends AnyStateHandle,
  const SKeys extends readonly (keyof UnwrapState<From> &
    string)[] = readonly [],
  const ETypes extends readonly UnwrapEvent<From>["type"][] = readonly [],
  OwnS extends object & ForbidKeys<SKeys[number]> = EmptyState,
  H extends AnyOwnHandlers<
    NoInfer<OwnS>,
    NoInfer<PickedState<UnwrapState<From>, SKeys>>,
    NoInfer<PickedEvents<UnwrapEvent<From>, ETypes>>
  > = Record<never, never>,
  const PKeys extends readonly (keyof OwnS & string)[] = never,
  P extends ScopePersistOptions<NoInfer<OwnS>, PKeys> | undefined = undefined,
>(
  options: ExtendScopeOptions<From, SKeys, ETypes, OwnS, H, PKeys, P> &
    NoEventCollision<H, ETypes[number]> &
    ValidHandlerEvents<H>,
): ScopeReturn<
  MergeState<PickedState<UnwrapState<From>, SKeys>, OwnS>,
  PickedEvents<UnwrapEvent<From>, ETypes> | InferHandlerEvents<H>,
  P
>;

export function createScope(options: {
  from?: InternalHandle;
  state?: readonly string[];
  events?: readonly string[];
  initial?: () => Record<string, unknown>;
  handlers?: Record<string, GenericHandler>;
  persist?: GenericPersistOptions;
}): ScopeInstance<Record<string, unknown>, ScopeEvent> {
  const internal = buildInternalScope({
    from: options.from,
    stateKeys: options.state ?? [],
    eventTypes: options.events ?? [],
    initial: options.initial,
    handlers: options.handlers,
    persist: options.persist,
  });
  internal.attach();

  return Object.freeze({
    state: internal.handle.state,
    dispatch: internal.handle.dispatch,
    dispose: internal.dispose,
    ...(internal.hydrate
      ? {
          hydrate: internal.hydrate,
          flush: internal.flush,
          getHydrationStatus: internal.getHydrationStatus,
        }
      : {}),
    [SCOPE_META]: getScopeMeta(internal.handle as InternalHandle),
  });
}

/**
 * Create, narrow, and/or widen a Valtio-backed state scope inside a React component.
 *
 * - Returns a referentially stable {@link StateHandle} as long as `from`,
 *   `state` keys, `events` names, owned `handlers` keys, and `persist.keys` are unchanged.
 * - Updates handler closures on commit so dispatched handlers always see fresh
 *   props/state without clobbering committed closures during aborted renders.
 * - Automatically attaches and cleans up subscriptions across mounts/StrictMode.
 */
export function useScope<
  OwnS extends object,
  H extends AnyOwnHandlers<NoInfer<OwnS>, EmptyState, never> = Record<
    never,
    never
  >,
  const PKeys extends readonly (keyof OwnS & string)[] = never,
  P extends ScopePersistOptions<NoInfer<OwnS>, PKeys> | undefined = undefined,
>(
  options: OwnScopeOptions<OwnS, H, PKeys, P> & ValidHandlerEvents<H>,
): UseScopeReturn<OwnS, InferHandlerEvents<H>, P>;

export function useScope<
  From extends AnyStateHandle,
  const SKeys extends readonly (keyof UnwrapState<From> &
    string)[] = readonly [],
  const ETypes extends readonly UnwrapEvent<From>["type"][] = readonly [],
>(
  options: NarrowScopeOptions<From, SKeys, ETypes>,
): StateHandle<
  PickedState<UnwrapState<From>, SKeys>,
  PickedEvents<UnwrapEvent<From>, ETypes>
>;

export function useScope<
  From extends AnyStateHandle,
  const SKeys extends readonly (keyof UnwrapState<From> &
    string)[] = readonly [],
  const ETypes extends readonly UnwrapEvent<From>["type"][] = readonly [],
  OwnS extends object & ForbidKeys<SKeys[number]> = EmptyState,
  H extends AnyOwnHandlers<
    NoInfer<OwnS>,
    NoInfer<PickedState<UnwrapState<From>, SKeys>>,
    NoInfer<PickedEvents<UnwrapEvent<From>, ETypes>>
  > = Record<never, never>,
  const PKeys extends readonly (keyof OwnS & string)[] = never,
  P extends ScopePersistOptions<NoInfer<OwnS>, PKeys> | undefined = undefined,
>(
  options: ExtendScopeOptions<From, SKeys, ETypes, OwnS, H, PKeys, P> &
    NoEventCollision<H, ETypes[number]> &
    ValidHandlerEvents<H>,
): UseScopeReturn<
  MergeState<PickedState<UnwrapState<From>, SKeys>, OwnS>,
  PickedEvents<UnwrapEvent<From>, ETypes> | InferHandlerEvents<H>,
  P
>;

export function useScope(options: {
  from?: InternalHandle;
  state?: readonly string[];
  events?: readonly string[];
  initial?: () => Record<string, unknown>;
  handlers?: Record<string, GenericHandler>;
  persist?: GenericPersistOptions;
}): StateHandle<Record<string, unknown>, ScopeEvent> {
  const stateKeys = options.state ?? [];
  const eventTypes = options.events ?? [];
  const ownEventNames = options.handlers ? Object.keys(options.handlers) : [];
  const persistKeys = options.persist?.keys ?? [];
  const sig = `${canonicalSig(stateKeys)}\n${canonicalSig(eventTypes)}\n${canonicalSig(ownEventNames)}\n${canonicalSig(persistKeys)}`;

  const committedRef = useRef<{
    from: InternalHandle | undefined;
    sig: string;
    internal: InternalScope<Record<string, unknown>, ScopeEvent>;
  } | null>(null);

  const committed = committedRef.current;
  const internal =
    committed && committed.from === options.from && committed.sig === sig
      ? committed.internal
      : buildInternalScope({
          from: options.from,
          stateKeys,
          eventTypes,
          ownEventNames,
          initial: options.initial,
          handlers: options.handlers,
          persist: options.persist,
        });

  useLayoutEffect(() => {
    committedRef.current = { from: options.from, sig, internal };
    internal.setHandlers(options.handlers);
    internal.setPersistCallbacks(options.persist);
  });

  useEffect(() => internal.attach(), [internal]);

  return internal.handle;
}
