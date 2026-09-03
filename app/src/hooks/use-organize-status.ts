import { useCallback, useEffect, useRef, useState } from "react";

import {
  getOrganizeStatus,
  type OrganizeStatus,
} from "@/api/kalaidoscope/organize";
import type { CollectionName } from "@/hooks/use-collection";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";

/** Collections whose changes can move the organise status. */
const WATCHED: CollectionName[] = [
  "ingest",
  "kalaidoscope_map",
  "map_run",
  "discover_run",
  "fragment_annotation",
];

/**
 * Annotation rows land in bursts (up to 100 concurrent), so coalesce a little
 * longer than `useLiveCollectionWatching` does before re-fetching.
 */
const COALESCE_MS = 300;

export interface UseOrganizeStatusResult {
  status: OrganizeStatus | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches `GET /api/organize` and re-fetches whenever a watched collection
 * emits a realtime event. Same shape as `useRotationStatus`: the server
 * recomputes on every call, so the client only decides *when* to ask.
 */
export function useOrganizeStatus(): UseOrganizeStatusResult {
  const client = useKalaidoscopeClient();
  const [status, setStatus] = useState<OrganizeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a re-run trigger for refetch(), not read in the effect
  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await getOrganizeStatus();
      if (!active) return;
      if (res.isErr()) {
        setError(res.error);
      } else {
        setError(null);
        setStatus(res.value);
      }
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [nonce]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const revalidate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refetchRef.current();
      }, COALESCE_MS);
    };

    for (const name of WATCHED) {
      void (async () => {
        try {
          const fn = await client.collection(name).subscribe("*", revalidate);
          if (cancelled) {
            void fn();
            return;
          }
          unsubs.push(fn);
        } catch (err) {
          console.error(`useOrganizeStatus(${name}): subscribe failed`, err);
        }
      })();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const fn of unsubs) void fn();
    };
  }, [client]);

  return { status, isLoading, error, refetch };
}
