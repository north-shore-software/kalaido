import { useEffect, useRef } from "react";
import useSWR, { unstable_serialize, useSWRConfig } from "swr";
import { registerLiveBinding } from "./registry";
import type { LiveReadResult, LiveReadStatus, LiveSource } from "./types";

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
  const { cache } = useSWRConfig();
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const serializedKey = source.key ? unstable_serialize(source.key) : null;
  const tagsKey = source.tags ? [...source.tags].sort().join("\0") : "";
  const hasSubscribe = source.subscribe !== undefined;
  const hasOfflineCache = source.offlineCache !== undefined;
  const coalesceMs = source.coalesceMs ?? 0;

  // Tracks whether authoritative server data has landed for the current key,
  // so a slow offlineCache.read() never overwrites fresher server data.
  const liveDataKeyRef = useRef<string | null>(null);
  const offlineSeedRef = useRef<T | undefined>(undefined);

  const swr = useSWR<T, Error>(
    source.key,
    async () => {
      const current = sourceRef.current;
      const result = await current.fetch();
      if (result.isErr()) {
        throw result.error;
      }

      let value = result.value;
      if (current.offlineCache) {
        let cached = offlineSeedRef.current;
        if (cached === undefined) {
          try {
            cached = await current.offlineCache.read();
          } catch (err) {
            console.error("useLiveRead: offlineCache.read failed", err);
          }
        }
        value = current.offlineCache.reconcile(cached, value);
        offlineSeedRef.current = value;
        void current.offlineCache.write(value).catch((err) => {
          console.error("useLiveRead: offlineCache.write failed", err);
        });
      }

      liveDataKeyRef.current = serializedKey;
      return value;
    },
    {
      revalidateOnFocus: source.revalidateOnFocus,
      revalidateOnReconnect: source.revalidateOnReconnect,
    },
  );

  const mutateRef = useRef(swr.mutate);
  mutateRef.current = swr.mutate;

  // Seed offline cache when available and live data has not landed yet.
  useEffect(() => {
    if (!serializedKey || !hasOfflineCache) return;
    let cancelled = false;
    offlineSeedRef.current = undefined;

    void (async () => {
      const offlineCache = sourceRef.current.offlineCache;
      if (!offlineCache) return;
      try {
        const cached = await offlineCache.read();
        if (cancelled || cached === undefined) return;
        offlineSeedRef.current = cached;
        if (liveDataKeyRef.current === serializedKey) return;
        await mutateRef.current((current) => current ?? cached, {
          revalidate: false,
        });
      } catch (err) {
        console.error("useLiveRead: offlineCache.read failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serializedKey, hasOfflineCache]);

  // Register active `(cache, key)` binding, tags, and shared push subscription.
  useEffect(() => {
    if (!serializedKey || !sourceRef.current.key) return;
    const rawKey = sourceRef.current.key;
    const tags = tagsKey ? tagsKey.split("\0") : [];
    const subscribe = hasSubscribe ? sourceRef.current.subscribe : undefined;

    return registerLiveBinding<T>({
      cache,
      serializedKey,
      rawKey,
      tags,
      coalesceMs,
      subscribe,
      revalidate: () => mutateRef.current(),
      setData: (value) => {
        liveDataKeyRef.current = serializedKey;
        return mutateRef.current(value, { revalidate: false });
      },
      clear: () => mutateRef.current(undefined, { revalidate: false }),
    });
  }, [cache, serializedKey, tagsKey, hasSubscribe, coalesceMs]);

  const error = swr.error ?? null;
  const status: LiveReadStatus =
    swr.data !== undefined
      ? "ready"
      : error !== null
        ? "error"
        : swr.isLoading
          ? "loading"
          : "ready";

  return {
    data: swr.data,
    status,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    error,
  };
}
