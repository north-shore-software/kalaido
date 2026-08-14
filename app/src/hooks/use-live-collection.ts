import { useEffect, useRef } from "react";
import type { SWRConfiguration } from "swr";

import type { CollectionResponses } from "@/api/kalaidoscope/types";
import {
  type CollectionName,
  type CollectionQuery,
  useCollection,
  type UseCollectionResult,
} from "@/hooks/use-collection";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";

/**
 * Like {@link useCollection}, but kept fresh by PocketBase realtime events.
 *
 * It does the exact same SWR fetch as `useCollection` and adds a realtime
 * subscription on the collection: every create/update/delete simply triggers a
 * revalidation (`mutate`). We deliberately do *not* merge event deltas into a
 * local copy — the event is only a signal to re-fetch, so the rendered list is
 * always whatever the server returns and never drifts out of sync.
 *
 * The return shape is identical to `useCollection`, so it's a drop-in upgrade
 * wherever you want a list that reacts to records appearing/changing/vanishing.
 */
export function useLiveCollection<N extends CollectionName>(
  collection: N,
  query: CollectionQuery = {},
  config?: SWRConfiguration<CollectionResponses[N][], Error>,
): UseCollectionResult<CollectionResponses[N]> {
  return useLiveCollectionWatching(collection, [collection], query, config);
}

/**
 * {@link useLiveCollection} where the events that trigger the revalidation come
 * from collections other than the one being read. Everything else — the fetch,
 * the coalescing, the return shape — is identical.
 *
 * Required for a *view*, which is never written to and so emits no realtime
 * events of its own: `watched` names the base collections it selects from.
 *
 * A `filter` in `query` always shapes the fetch, but it is only passed to a
 * subscription on the collection being read — it is written against that
 * collection's columns and need not hold on a watched one.
 */
export function useLiveCollectionWatching<N extends CollectionName>(
  collection: N,
  watched: CollectionName[],
  query: CollectionQuery = {},
  config?: SWRConfiguration<CollectionResponses[N][], Error>,
): UseCollectionResult<CollectionResponses[N]> {
  const client = useKalaidoscopeClient();
  const result = useCollection(collection, query, config);

  const { enabled = true, filter } = query;
  const watchedKey = watched.join(",");

  // SWR can hand back a fresh `mutate` identity across renders; keep the latest
  // in a ref so the subscription effect doesn't tear down/re-subscribe for it.
  const mutateRef = useRef(result.mutate);
  mutateRef.current = result.mutate;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const unsubs: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Coalesce bursts (e.g. a snapshot insert + projection update arriving
    // together) into a single revalidation.
    const revalidate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void mutateRef.current();
      }, 50);
    };

    for (const name of watchedKey.split(",") as CollectionName[]) {
      void (async () => {
        try {
          const opts = filter && name === collection ? { filter } : undefined;
          const fn = await client
            .collection(name)
            .subscribe("*", revalidate, opts);
          if (cancelled) {
            void fn();
            return;
          }
          unsubs.push(fn);
        } catch (err) {
          console.error(
            `useLiveCollectionWatching(${name}): subscribe failed`,
            err,
          );
        }
      })();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const fn of unsubs) void fn();
    };
    // `client` is stable per kalaidoscope scope; re-subscribe if scope,
    // watched collections, filter, or enabled changes.
  }, [client, collection, watchedKey, filter, enabled]);

  return result;
}
