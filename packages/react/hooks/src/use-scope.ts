import { useEffect, useRef } from "react";
import { proxy, ref, type Snapshot, snapshot, subscribe } from "valtio";

export type ScopeEvent = { readonly type: string };

const SCOPE_META = Symbol("kalaido.scopeMeta");

interface ScopeMeta {
  readonly keys: ReadonlySet<string>;
  readonly events: ReadonlySet<string>;
}

/**
 * Read-only reactive state paired with its owner's event dispatcher.
 *
 * - Read state with Valtio's `useSnapshot(handle.state)`.
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

/** A root or derived scope created outside React, with explicit cleanup. */
export interface ScopeInstance<
  S extends object = Record<never, never>,
  E extends ScopeEvent = never,
> extends StateHandle<S, E> {
  readonly dispose: () => void;
}

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
  ? unknown extends E
    ? { readonly type: K }
    : E extends { readonly type: K }
      ? E
      : never
  : { readonly type: K };

type InferHandlerEvents<H> = {
  [K in keyof H & string]: EventForHandler<K, H[K]>;
}[keyof H & string];

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
> {
  readonly from?: undefined;
  readonly initial: () => OwnS;
  readonly handlers?: H & AnyOwnHandlers<NoInfer<OwnS>, EmptyState, never>;
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
}

type InternalHandle = StateHandle<Record<string, unknown>, ScopeEvent> & {
  [SCOPE_META]?: ScopeMeta;
};

interface InternalScope<S extends object, E extends ScopeEvent> {
  readonly handle: StateHandle<S, E>;
  readonly attach: () => () => void;
  setHandlers: (handlers: Record<string, GenericHandler> | undefined) => void;
}

type GenericHandler = (
  state: Record<string, unknown>,
  event: ScopeEvent,
  ctx: ScopeHandlerContext<Record<string, unknown>, ScopeEvent>,
) => void | Promise<void>;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Error
  ) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

function freezeRef<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  return ref(deepFreeze(value));
}

function getScopeMeta(handle: InternalHandle): ScopeMeta | undefined {
  return handle[SCOPE_META];
}

function buildInternalScope(options: {
  from?: InternalHandle;
  stateKeys: readonly string[];
  eventTypes: readonly string[];
  initial?: () => Record<string, unknown>;
  handlers?: Record<string, GenericHandler>;
}): InternalScope<Record<string, unknown>, ScopeEvent> {
  const { from, stateKeys, eventTypes, initial } = options;
  let currentHandlers = options.handlers;

  const parentKeySet = new Set(stateKeys);
  const parentEventSet = new Set(eventTypes);

  if (from) {
    const parentMeta = getScopeMeta(from);
    if (parentMeta) {
      for (const k of parentKeySet) {
        if (!parentMeta.keys.has(k)) {
          throw new Error(
            `Cannot narrow state key "${k}": not exposed by parent scope.`,
          );
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

  const ownInitial = initial ? initial() : undefined;
  const ownKeys = ownInitial ? Object.keys(ownInitial) : [];
  const ownKeySet = new Set(ownKeys);

  for (const k of ownKeySet) {
    if (parentKeySet.has(k)) {
      throw new Error(
        `Scope state key "${k}" collides with forwarded parent state key.`,
      );
    }
  }

  const ownEventNames = currentHandlers ? Object.keys(currentHandlers) : [];
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

  // Build the outward-facing read-only view proxy synchronously so first render
  // sees initial values immediately.
  const viewInit: Record<string, unknown> = {};
  if (from && parentKeySet.size > 0) {
    const parentSnap = snapshot(from.state) as Record<string, unknown>;
    for (const k of parentKeySet) {
      viewInit[k] = freezeRef(parentSnap[k]);
    }
  }
  if (ownProxy) {
    const ownSnap = snapshot(ownProxy) as Record<string, unknown>;
    for (const k of ownKeySet) {
      viewInit[k] = freezeRef(ownSnap[k]);
    }
  }

  const viewProxy = proxy<Record<string, unknown>>(viewInit);
  const allAllowedKeys = new Set([...parentKeySet, ...ownKeySet]);
  const allAllowedEvents = new Set([...parentEventSet, ...ownEventSet]);

  let syncing = false;
  let attached = false;

  const syncKeys = (source: object, keys: Iterable<string>) => {
    syncing = true;
    try {
      const snap = snapshot(source) as Record<string, unknown>;
      for (const k of keys) {
        const next = freezeRef(snap[k]);
        if (!Object.is(viewProxy[k], next)) {
          viewProxy[k] = next;
        }
      }
    } finally {
      syncing = false;
    }
  };

  // Guard viewProxy against direct external mutations at runtime (even via `as any`).
  // Kept active for the lifetime of viewProxy so `state` is always read-only.
  subscribe(
    viewProxy,
    () => {
      if (syncing) return;
      syncing = true;
      try {
        for (const key of Object.keys(viewProxy)) {
          if (!allAllowedKeys.has(key)) {
            delete viewProxy[key];
          }
        }
        if (from && parentKeySet.size > 0) {
          const parentSnap = snapshot(from.state) as Record<string, unknown>;
          for (const k of parentKeySet) {
            viewProxy[k] = freezeRef(parentSnap[k]);
          }
        }
        if (ownProxy && ownKeySet.size > 0) {
          const ownSnap = snapshot(ownProxy) as Record<string, unknown>;
          for (const k of ownKeySet) {
            viewProxy[k] = freezeRef(ownSnap[k]);
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
        out[k] = parentSnap[k];
      }
    }
    return Object.freeze(out) as Snapshot<Record<string, unknown>>;
  };

  const dispatchParent = async (event: ScopeEvent): Promise<void> => {
    if (!from || !parentEventSet.has(event.type)) {
      throw new Error(
        `Event "${event.type}" is not permitted on this scope handle.`,
      );
    }
    await from.dispatch(event);
  };

  const dispatch = async (event: ScopeEvent): Promise<void> => {
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
      try {
        await handler(ownProxy, event, ctx);
      } finally {
        // Ensure viewProxy reflects mutations even if dispatched before attach().
        if (!attached) {
          syncKeys(ownProxy, ownKeySet);
        }
      }
      return;
    }

    if (from && parentEventSet.has(event.type)) {
      await from.dispatch(event);
      return;
    }

    throw new Error(
      `Event "${event.type}" is not permitted on this scope handle.`,
    );
  };

  const attach = (): (() => void) => {
    const unsubs: (() => void)[] = [];
    attached = true;

    if (from && parentKeySet.size > 0) {
      unsubs.push(
        subscribe(
          from.state,
          () => {
            syncKeys(from.state, parentKeySet);
          },
          true,
        ),
      );
      // Catch-up sync in case parent mutated between render and commit.
      syncKeys(from.state, parentKeySet);
    }

    if (ownProxy && ownKeySet.size > 0) {
      unsubs.push(
        subscribe(
          ownProxy,
          () => {
            syncKeys(ownProxy, ownKeySet);
          },
          true,
        ),
      );
      syncKeys(ownProxy, ownKeySet);
    }

    return () => {
      attached = false;
      for (const unsub of unsubs) unsub();
    };
  };

  const handle: InternalHandle = Object.freeze({
    state: viewProxy as Snapshot<Record<string, unknown>>,
    dispatch,
    [SCOPE_META]: {
      keys: allAllowedKeys,
      events: allAllowedEvents,
    },
  });

  return {
    handle,
    attach,
    setHandlers: (next) => {
      currentHandlers = next;
    },
  };
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
>(
  options: OwnScopeOptions<OwnS, H>,
): ScopeInstance<OwnS, InferHandlerEvents<H>>;

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
>(
  options: ExtendScopeOptions<From, SKeys, ETypes, OwnS, H> &
    NoEventCollision<H, ETypes[number]>,
): ScopeInstance<
  MergeState<PickedState<UnwrapState<From>, SKeys>, OwnS>,
  PickedEvents<UnwrapEvent<From>, ETypes> | InferHandlerEvents<H>
>;

export function createScope(options: {
  from?: InternalHandle;
  state?: readonly string[];
  events?: readonly string[];
  initial?: () => Record<string, unknown>;
  handlers?: Record<string, GenericHandler>;
}): ScopeInstance<Record<string, unknown>, ScopeEvent> {
  const internal = buildInternalScope({
    from: options.from,
    stateKeys: options.state ?? [],
    eventTypes: options.events ?? [],
    initial: options.initial,
    handlers: options.handlers,
  });
  const dispose = internal.attach();

  return Object.freeze({
    state: internal.handle.state,
    dispatch: internal.handle.dispatch,
    dispose,
    [SCOPE_META]: getScopeMeta(internal.handle as InternalHandle),
  });
}

/**
 * Create, narrow, and/or widen a Valtio-backed state scope inside a React component.
 *
 * - Returns a referentially stable {@link StateHandle} as long as `from`,
 *   `state` keys, and `events` names are unchanged.
 * - Always invokes the latest `handlers` closure on `dispatch`.
 * - Automatically attaches and cleans up subscriptions across mounts/StrictMode.
 */
export function useScope<
  OwnS extends object,
  H extends AnyOwnHandlers<NoInfer<OwnS>, EmptyState, never> = Record<
    never,
    never
  >,
>(options: OwnScopeOptions<OwnS, H>): StateHandle<OwnS, InferHandlerEvents<H>>;

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
>(
  options: ExtendScopeOptions<From, SKeys, ETypes, OwnS, H> &
    NoEventCollision<H, ETypes[number]>,
): StateHandle<
  MergeState<PickedState<UnwrapState<From>, SKeys>, OwnS>,
  PickedEvents<UnwrapEvent<From>, ETypes> | InferHandlerEvents<H>
>;

export function useScope(options: {
  from?: InternalHandle;
  state?: readonly string[];
  events?: readonly string[];
  initial?: () => Record<string, unknown>;
  handlers?: Record<string, GenericHandler>;
}): StateHandle<Record<string, unknown>, ScopeEvent> {
  const stateKeys = options.state ?? [];
  const eventTypes = options.events ?? [];
  const stateSig = stateKeys.join("\0");
  const eventSig = eventTypes.join("\0");

  const refBox = useRef<{
    from: InternalHandle | undefined;
    stateSig: string;
    eventSig: string;
    internal: InternalScope<Record<string, unknown>, ScopeEvent>;
  } | null>(null);

  if (
    !refBox.current ||
    refBox.current.from !== options.from ||
    refBox.current.stateSig !== stateSig ||
    refBox.current.eventSig !== eventSig
  ) {
    refBox.current = {
      from: options.from,
      stateSig,
      eventSig,
      internal: buildInternalScope({
        from: options.from,
        stateKeys,
        eventTypes,
        initial: options.initial,
        handlers: options.handlers,
      }),
    };
  }

  // Always point to the latest handler closures without recreating the handle.
  const current = refBox.current.internal;
  current.setHandlers(options.handlers);

  useEffect(() => current.attach(), [current]);

  return current.handle;
}
