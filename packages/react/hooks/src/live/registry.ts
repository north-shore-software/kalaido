import { mutate as globalMutate, unstable_serialize } from "swr";
import type { LiveSubscribeCallbacks, LiveTag } from "./types";

export interface RegisterLiveBindingInput<T> {
  readonly cache: object;
  readonly serializedKey: string;
  readonly rawKey: readonly unknown[];
  readonly tags: readonly LiveTag[];
  readonly revalidate: () => Promise<unknown>;
  readonly setData: (value: T) => Promise<unknown>;
  readonly clear: () => Promise<unknown>;
  readonly subscribe?: (callbacks: LiveSubscribeCallbacks<T>) => () => void;
  readonly coalesceMs: number;
}

interface BindingRecord {
  readonly tags: readonly LiveTag[];
  readonly revalidate: () => Promise<unknown>;
  readonly setData: (value: unknown) => Promise<unknown>;
  readonly clear: () => Promise<unknown>;
  readonly coalesceMs: number;
}

interface KeyEntry {
  readonly serializedKey: string;
  readonly rawKey: readonly unknown[];
  readonly bindings: Set<BindingRecord>;
  unsub: (() => void) | null;
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

function attachSubscription<T>(
  entry: KeyEntry,
  subscribe: (callbacks: LiveSubscribeCallbacks<T>) => () => void,
): void {
  const invalidate = () => {
    const active = firstBinding(entry);
    if (!active) return;
    const delay = active.coalesceMs;
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

  const setData = (value: T) => {
    const active = firstBinding(entry);
    if (active) {
      void active.setData(value);
    }
  };

  entry.unsub = subscribe({ invalidate, setData });
}

export function registerLiveBinding<T>(
  input: RegisterLiveBindingInput<T>,
): () => void {
  const cacheMap = getCacheMap(input.cache);
  let entry = cacheMap.get(input.serializedKey);

  if (!entry) {
    entry = {
      serializedKey: input.serializedKey,
      rawKey: input.rawKey,
      bindings: new Set(),
      unsub: null,
      timer: undefined,
    };
    cacheMap.set(input.serializedKey, entry);
  }

  const record: BindingRecord = {
    tags: input.tags,
    revalidate: input.revalidate,
    setData: (v) => input.setData(v as T),
    clear: input.clear,
    coalesceMs: input.coalesceMs,
  };
  entry.bindings.add(record);

  if (entry.unsub === null && input.subscribe) {
    attachSubscription(entry, input.subscribe);
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
      if (currentEntry.unsub) {
        const fn = currentEntry.unsub;
        currentEntry.unsub = null;
        fn();
      }
      if (cacheMap.get(input.serializedKey) === currentEntry) {
        cacheMap.delete(input.serializedKey);
      }
      if (cacheMap.size === 0) {
        entriesByCache.delete(input.cache);
        activeCaches.delete(input.cache);
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
        tasks.push(active.revalidate());
      }
    }
  }

  await Promise.all(tasks);
}

async function clearMatchingKeys(
  matches: (rawKey: readonly unknown[]) => boolean,
  matchesSerialized: (serializedKey: string) => boolean,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  for (const cache of activeCaches) {
    const cacheMap = entriesByCache.get(cache);
    if (!cacheMap) continue;
    for (const entry of cacheMap.values()) {
      if (matches(entry.rawKey)) {
        const active = firstBinding(entry);
        if (active) tasks.push(active.clear());
      }
    }
  }

  // Also evict unmounted entries from the default global SWR cache.
  tasks.push(
    globalMutate(
      (k) => {
        if (Array.isArray(k)) return matches(k);
        if (typeof k === "string") return matchesSerialized(k);
        return false;
      },
      undefined,
      { revalidate: false },
    ),
  );

  await Promise.all(tasks);
}

/** Evict cached live reads scoped to a PocketBase workspace `baseURL`. */
export function clearWorkspaceLiveCache(baseURL: string): Promise<void> {
  const serializedPrefix = unstable_serialize(["pb", baseURL]);
  return clearMatchingKeys(
    (k) => k[0] === "pb" && k[1] === baseURL,
    (s) => s.includes(baseURL) && s.startsWith(serializedPrefix.slice(0, 6)),
  );
}

/** Evict cached live reads scoped to cloud account state (sign-out). */
export function clearCloudLiveCache(): Promise<void> {
  return clearMatchingKeys(
    (k) => k[0] === "cloud",
    (s) => s.includes('"cloud"'),
  );
}

/** Test-only helper to inspect registered key and tag counts. */
export function _liveRegistrySize(): { keys: number; tags: number } {
  let keys = 0;
  for (const cache of activeCaches) {
    keys += entriesByCache.get(cache)?.size ?? 0;
  }
  return { keys, tags: keysByTag.size };
}
