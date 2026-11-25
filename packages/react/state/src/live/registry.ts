import { type Cache, mutate as globalMutate, type ScopedMutator } from "swr";
import type { LiveSubscribeCallbacks, LiveTag } from "./types";

export interface RegisterLiveBindingInput<T> {
  readonly cache: Cache;
  readonly scopedMutate: ScopedMutator;
  readonly serializedKey: string;
  readonly rawKey: readonly unknown[];
  readonly tags: readonly LiveTag[];
  readonly revalidate: () => Promise<unknown>;
  readonly setData: (value: T) => Promise<unknown>;
  readonly clear: () => Promise<unknown>;
  readonly subscribe?: (callbacks: LiveSubscribeCallbacks<T>) => () => void;
  readonly subscribeKey?: unknown;
  readonly coalesceMs: number;
}

interface BindingRecord {
  readonly tags: readonly LiveTag[];
  readonly revalidate: () => Promise<unknown>;
  readonly setData: (value: unknown) => Promise<unknown>;
  readonly clear: () => Promise<unknown>;
  readonly subscribe?: (
    callbacks: LiveSubscribeCallbacks<unknown>,
  ) => () => void;
  readonly subscribeKey: unknown;
  readonly coalesceMs: number;
}

interface KeyEntry {
  readonly serializedKey: string;
  readonly rawKey: readonly unknown[];
  readonly bindings: Set<BindingRecord>;
  unsub: (() => void) | null;
  subKey: unknown;
  hadDisconnect: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Per-SWR-cache registry of active `useLiveRead` bindings.
 *
 * Scoped by SWR `cache` identity so isolated `<SWRConfig>` trees (e.g. tests)
 * never cross-talk, while multiple consumers sharing the same `(cache, key)`:
 * - attach a single push subscription (`source.subscribe`)
 * - share a single coalescing timer
 * - trigger a single SWR revalidation per event or tag invalidation
 */
const activeCaches = new Set<object>();
const entriesByCache = new WeakMap<object, Map<string, KeyEntry>>();
const keysByTag = new Map<LiveTag, Set<{ cache: object; key: string }>>();

interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

const WeakRefCtor = (
  globalThis as unknown as {
    WeakRef?: new <T extends object>(target: T) => WeakRefLike<T>;
  }
).WeakRef;

const knownCaches = new Set<WeakRefLike<Cache>>();
const cacheRefs = new WeakMap<object, WeakRefLike<Cache>>();
const mutatorByCache = new WeakMap<object, ScopedMutator>();

function recordKnownCache(cache: Cache, scopedMutate: ScopedMutator): void {
  mutatorByCache.set(cache, scopedMutate);
  if (!cacheRefs.has(cache)) {
    const ref: WeakRefLike<Cache> = WeakRefCtor
      ? new WeakRefCtor(cache)
      : { deref: () => cache };
    cacheRefs.set(cache, ref);
    knownCaches.add(ref);
  }
}

function getCacheMap(cache: object): Map<string, KeyEntry> {
  let map = entriesByCache.get(cache);
  if (!map) {
    map = new Map();
    entriesByCache.set(cache, map);
    activeCaches.add(cache);
  }
  return map;
}

function firstBinding(entry: KeyEntry): BindingRecord | undefined {
  for (const b of entry.bindings) return b;
  return undefined;
}

function subscriberBinding(entry: KeyEntry): BindingRecord | undefined {
  let found: BindingRecord | undefined;
  for (const b of entry.bindings) {
    if (b.subscribe) found = b;
  }
  return found;
}

function minCoalesceMs(entry: KeyEntry): number {
  let min = Number.POSITIVE_INFINITY;
  for (const b of entry.bindings) {
    if (b.coalesceMs < min) min = b.coalesceMs;
  }
  return Number.isFinite(min) ? min : 0;
}

function detachSubscription(entry: KeyEntry): void {
  if (entry.unsub) {
    const fn = entry.unsub;
    entry.unsub = null;
    entry.subKey = undefined;
    fn();
  }
}

function attachSubscription(
  entry: KeyEntry,
  subscribe: (callbacks: LiveSubscribeCallbacks<unknown>) => () => void,
  subscribeKey: unknown,
): void {
  let activeSub = true;
  let wrappedUnsub: (() => void) | null = null;
  const isRecovery = entry.hadDisconnect;

  const invalidate = () => {
    const active = firstBinding(entry);
    if (!active) return;
    const delay = minCoalesceMs(entry);
    if (delay <= 0) {
      void active.revalidate();
      return;
    }
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      const latest = firstBinding(entry);
      if (latest) {
        void latest.revalidate();
      }
    }, delay);
  };

  const setData = (value: unknown) => {
    const active = firstBinding(entry);
    if (active) {
      void active.setData(value);
    }
  };

  const connected = () => {
    if (!activeSub) return;
    entry.hadDisconnect = false;
    if (isRecovery) {
      invalidate();
    }
  };

  const disconnect = () => {
    if (!activeSub) return;
    activeSub = false;
    entry.hadDisconnect = true;
    if (wrappedUnsub && entry.unsub === wrappedUnsub) {
      entry.unsub = null;
      entry.subKey = undefined;
    }
  };

  const rawUnsub = subscribe({ invalidate, setData, connected, disconnect });
  wrappedUnsub = () => {
    if (!activeSub) return;
    activeSub = false;
    rawUnsub();
  };

  if (activeSub) {
    entry.unsub = wrappedUnsub;
    entry.subKey = subscribeKey;
  } else {
    rawUnsub();
  }
}

export function ensureLiveSubscription(
  cache: object,
  serializedKey: string,
): void {
  const entry = entriesByCache.get(cache)?.get(serializedKey);
  if (!entry || entry.unsub !== null) return;
  const sub = subscriberBinding(entry);
  if (sub?.subscribe) {
    attachSubscription(entry, sub.subscribe, sub.subscribeKey);
  }
}

export function registerLiveBinding<T>(
  input: RegisterLiveBindingInput<T>,
): () => void {
  recordKnownCache(input.cache, input.scopedMutate);
  const cacheMap = getCacheMap(input.cache);
  let entry = cacheMap.get(input.serializedKey);

  if (!entry) {
    entry = {
      serializedKey: input.serializedKey,
      rawKey: input.rawKey,
      bindings: new Set(),
      unsub: null,
      subKey: undefined,
      hadDisconnect: false,
      timer: undefined,
    };
    cacheMap.set(input.serializedKey, entry);
  }

  const subFn = input.subscribe;
  const record: BindingRecord = {
    tags: input.tags,
    revalidate: input.revalidate,
    setData: (v) => input.setData(v as T),
    clear: input.clear,
    subscribe: subFn
      ? (cbs) => subFn(cbs as LiveSubscribeCallbacks<T>)
      : undefined,
    subscribeKey: input.subscribeKey,
    coalesceMs: input.coalesceMs,
  };
  entry.bindings.add(record);

  if (record.subscribe) {
    if (entry.unsub === null) {
      attachSubscription(entry, record.subscribe, record.subscribeKey);
    } else if (!Object.is(entry.subKey, record.subscribeKey)) {
      detachSubscription(entry);
      attachSubscription(entry, record.subscribe, record.subscribeKey);
    }
  }

  const tagRefs: { tag: LiveTag; ref: { cache: object; key: string } }[] = [];
  for (const tag of input.tags) {
    let set = keysByTag.get(tag);
    if (!set) {
      set = new Set();
      keysByTag.set(tag, set);
    }
    const ref = { cache: input.cache, key: input.serializedKey };
    set.add(ref);
    tagRefs.push({ tag, ref });
  }

  const currentEntry = entry;
  return () => {
    currentEntry.bindings.delete(record);

    for (const { tag, ref } of tagRefs) {
      const set = keysByTag.get(tag);
      if (set) {
        set.delete(ref);
        if (set.size === 0) keysByTag.delete(tag);
      }
    }

    if (currentEntry.bindings.size === 0) {
      if (currentEntry.timer) {
        clearTimeout(currentEntry.timer);
        currentEntry.timer = undefined;
      }
      detachSubscription(currentEntry);
      if (cacheMap.get(input.serializedKey) === currentEntry) {
        cacheMap.delete(input.serializedKey);
      }
      if (cacheMap.size === 0) {
        entriesByCache.delete(input.cache);
        activeCaches.delete(input.cache);
      }
    } else if (currentEntry.unsub !== null) {
      const remainingSub = subscriberBinding(currentEntry);
      if (!remainingSub?.subscribe) {
        detachSubscription(currentEntry);
      } else if (!Object.is(currentEntry.subKey, remainingSub.subscribeKey)) {
        detachSubscription(currentEntry);
        attachSubscription(
          currentEntry,
          remainingSub.subscribe,
          remainingSub.subscribeKey,
        );
      }
    }
  };
}

/**
 * Revalidate every active live read registered under any of `tags`.
 * Deduplicates by `(cache, serializedKey)` so multiple mounted consumers of
 * the same key trigger a single revalidation.
 */
export async function invalidateLiveTags(
  tags: readonly LiveTag[],
): Promise<void> {
  if (tags.length === 0) return;

  const targets = new Map<object, Set<string>>();
  for (const tag of tags) {
    const tagged = keysByTag.get(tag);
    if (!tagged) continue;
    for (const { cache, key } of tagged) {
      let keys = targets.get(cache);
      if (!keys) {
        keys = new Set();
        targets.set(cache, keys);
      }
      keys.add(key);
    }
  }

  const tasks: Promise<unknown>[] = [];
  for (const [cache, keys] of targets) {
    const cacheMap = entriesByCache.get(cache);
    if (!cacheMap) continue;
    for (const key of keys) {
      const entry = cacheMap.get(key);
      const active = entry ? firstBinding(entry) : undefined;
      if (active) {
        ensureLiveSubscription(cache, key);
        tasks.push(active.revalidate());
      }
    }
  }

  await Promise.all(tasks);
}

/**
 * Evict cached live reads matching `matches` from every known SWR cache
 * (both mounted and unmounted entries, including isolated `<SWRConfig>` trees).
 */
export async function clearLiveCache(
  matches: (rawKey: readonly unknown[]) => boolean,
  matchesSerialized?: (serializedKey: string) => boolean,
): Promise<void> {
  const keyFilter = (k: unknown): boolean => {
    if (Array.isArray(k)) return matches(k);
    if (typeof k === "string" && matchesSerialized) {
      return matchesSerialized(k);
    }
    return false;
  };

  const tasks: Promise<unknown>[] = [];

  for (const cache of activeCaches) {
    const cacheMap = entriesByCache.get(cache);
    if (!cacheMap) continue;
    for (const entry of cacheMap.values()) {
      if (matches(entry.rawKey)) {
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = undefined;
        }
        for (const binding of entry.bindings) {
          tasks.push(binding.clear());
        }
      }
    }
  }

  const liveCaches: Cache[] = [];
  for (const ref of knownCaches) {
    const cache = ref.deref();
    if (!cache) {
      knownCaches.delete(ref);
      continue;
    }
    liveCaches.push(cache);
    const scopedMutate = mutatorByCache.get(cache);
    if (scopedMutate && activeCaches.has(cache)) {
      tasks.push(scopedMutate(keyFilter, undefined, { revalidate: false }));
    }
  }

  tasks.push(globalMutate(keyFilter, undefined, { revalidate: false }));

  await Promise.all(tasks);

  // Remove unmounted tombstones from known caches so evicted entries disappear completely.
  for (const cache of liveCaches) {
    const activeMap = entriesByCache.get(cache);
    for (const serializedKey of Array.from(cache.keys())) {
      if (activeMap?.has(serializedKey)) continue;
      const item = cache.get(serializedKey) as { _k?: unknown } | undefined;
      if (
        (item?._k !== undefined && keyFilter(item._k)) ||
        matchesSerialized?.(serializedKey)
      ) {
        cache.delete(serializedKey);
      }
    }
  }
}

/** Test-only helper to inspect registered key and tag counts. */
export function _liveRegistrySize(): { keys: number; tags: number } {
  let keys = 0;
  for (const cache of activeCaches) {
    keys += entriesByCache.get(cache)?.size ?? 0;
  }
  return { keys, tags: keysByTag.size };
}
