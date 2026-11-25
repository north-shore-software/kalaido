import { useEffect, useRef, useState } from "react";
import useSWR, { unstable_serialize, useSWRConfig } from "swr";
import { ensureLiveSubscription, registerLiveBinding } from "./registry";
import type {
  LiveOfflineCache,
  LiveReadResult,
  LiveReadStatus,
  LiveSource,
} from "./types";

async function reconcileOfflineValue<T>(
  offlineCache: LiveOfflineCache<T>,
  seeds: Map<string, T>,
  fetchKey: string,
  fresh: T,
): Promise<T> {
  let cached = seeds.get(fetchKey);
  if (cached === undefined) {
    try {
      cached = await offlineCache.read();
    } catch (err) {
      console.error("useLiveRead: offlineCache.read failed", err);
    }
  }
  const reconciled = offlineCache.reconcile(cached, fresh);
  seeds.set(fetchKey, reconciled);
  void offlineCache.write(reconciled).catch((err) => {
    console.error("useLiveRead: offlineCache.write failed", err);
  });
  return reconciled;
}

function deriveLiveStatus<T>(
  data: T | undefined,
  error: Error | null,
  isLoading: boolean,
): LiveReadStatus {
  if (data !== undefined) return "ready";
  if (error !== null) return "error";
  return isLoading ? "loading" : "ready";
}

/**
 * Unified external live-read hook backed by SWR.
 *
 * Accepts any `LiveSource<T>` (PocketBase collection, computed PocketBase
 * endpoint, non-push HTTP endpoint, or reactive atom) and exposes a single
 * uniform read contract with:
 * - shared SWR caching & request deduping
 * - ref-counted push subscriptions & coalesced invalidation shared per `(cache, key)`
 * - automatic registration for paired-write tag invalidation
 * - optional offline cache fallback/reconciliation (cloud-workspaces exception)
 */
export function useLiveRead<T>(source: LiveSource<T>): LiveReadResult<T> {
  const { cache, mutate: scopedMutate } = useSWRConfig();
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const serializedKey = source.key ? unstable_serialize(source.key) : null;
  const tagsKey = source.tags ? [...source.tags].sort().join("\0") : "";
  const hasSubscribe = source.subscribe !== undefined;
  const subscribeKey = source.subscribeKey;
  const hasOfflineCache = source.offlineCache !== undefined;
  const hasInitialData = source.getInitialData !== undefined;
  const coalesceMs = source.coalesceMs ?? 0;

  const offlineSeedsRef = useRef(new Map<string, T>());
  const [offlineFallback, setOfflineFallback] = useState<{
    readonly key: string;
    readonly value: T;
  } | null>(null);
  const [evictedKey, setEvictedKey] = useState<string | null>(null);
  const fetchedKeysRef = useRef(new Set<string>());

  const canUseInitial =
    Boolean(serializedKey) && hasInitialData && evictedKey !== serializedKey;
  const initialFallback = canUseInitial ? source.getInitialData?.() : undefined;

  const swr = useSWR<T, Error>(
    source.key,
    async () => {
      const current = sourceRef.current;
      const fetchKey = serializedKey;
      if (fetchKey && fetchedKeysRef.current.has(fetchKey)) {
        ensureLiveSubscription(cache, fetchKey);
      }
      const result = await current.fetch();
      if (result.isErr()) {
        if (fetchKey) fetchedKeysRef.current.add(fetchKey);
        throw result.error;
      }

      let value = result.value;
      if (current.offlineCache && fetchKey) {
        value = await reconcileOfflineValue(
          current.offlineCache,
          offlineSeedsRef.current,
          fetchKey,
          value,
        );
        setOfflineFallback((prev) =>
          prev?.key === fetchKey ? { key: fetchKey, value } : prev,
        );
      }

      if (fetchKey) {
        fetchedKeysRef.current.add(fetchKey);
        setEvictedKey((prev) => (prev === fetchKey ? null : prev));
      }
      return value;
    },
    {
      fallbackData: initialFallback,
      revalidateOnMount: hasInitialData ? false : undefined,
      revalidateOnFocus: source.revalidateOnFocus,
      revalidateOnReconnect: source.revalidateOnReconnect,
    },
  );

  const mutateRef = useRef(swr.mutate);
  mutateRef.current = swr.mutate;

  useEffect(() => {
    if (!serializedKey || !hasOfflineCache) return;
    let cancelled = false;

    void (async () => {
      const offlineCache = sourceRef.current.offlineCache;
      if (!offlineCache) return;
      try {
        const cached = await offlineCache.read();
        if (cancelled || cached === undefined) return;
        const seeds = offlineSeedsRef.current;
        if (!seeds.has(serializedKey)) {
          seeds.set(serializedKey, cached);
        }
        const seed = seeds.get(serializedKey) ?? cached;
        setOfflineFallback((prev) =>
          prev?.key === serializedKey
            ? prev
            : { key: serializedKey, value: seed },
        );
      } catch (err) {
        console.error("useLiveRead: offlineCache.read failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serializedKey, hasOfflineCache]);

  useEffect(() => {
    if (!serializedKey || !sourceRef.current.key) return;
    const rawKey = sourceRef.current.key;
    const tags = tagsKey ? tagsKey.split("\0") : [];
    const subscribe = hasSubscribe ? sourceRef.current.subscribe : undefined;

    return registerLiveBinding<T>({
      cache,
      scopedMutate,
      serializedKey,
      rawKey,
      tags,
      coalesceMs,
      subscribe,
      subscribeKey,
      revalidate: () => mutateRef.current(),
      setData: (value) => {
        setEvictedKey((prev) => (prev === serializedKey ? null : prev));
        return mutateRef.current(value, { revalidate: false });
      },
      clear: () => {
        offlineSeedsRef.current.delete(serializedKey);
        setOfflineFallback((prev) =>
          prev?.key === serializedKey ? null : prev,
        );
        if (hasInitialData) {
          setEvictedKey(serializedKey);
        }
        return mutateRef.current(undefined, { revalidate: false });
      },
    });
  }, [
    cache,
    scopedMutate,
    serializedKey,
    tagsKey,
    hasSubscribe,
    subscribeKey,
    hasInitialData,
    coalesceMs,
  ]);

  const fallbackVal =
    offlineFallback?.key === serializedKey ? offlineFallback.value : undefined;
  const data = swr.data !== undefined ? swr.data : fallbackVal;
  const error = swr.error ?? null;
  const isLoading = data === undefined && swr.isLoading;

  return {
    data,
    status: deriveLiveStatus(data, error, isLoading),
    isLoading,
    isValidating: swr.isValidating,
    error,
  };
}
