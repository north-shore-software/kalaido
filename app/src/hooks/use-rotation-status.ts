import { useCallback, useEffect, useMemo, useState } from "react";

import { type EntityStatus, getRotation } from "@/api/kalaidoscope/rotation";

export interface UseRotationStatusResult {
  /** All entity statuses, in the server's topological order (deps first). */
  statuses: EntityStatus[];
  byId: Map<string, EntityStatus>;
  isLoading: boolean;
  error: Error | null;
  /** Re-fetch the plan (recomputed server-side) — call after an approve. */
  refetch: () => void;
}

/**
 * Fetches the read-only staleness plan from `GET /api/rotation`. The plan has no
 * server-side session, so advancing a rotation queue is just `refetch()` after
 * each approve. Shared by the projections list, projection detail metrics, and
 * the rotation page.
 */
export function useRotationStatus(): UseRotationStatusResult {
  const [statuses, setStatuses] = useState<EntityStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a re-run trigger for refetch(), not read in the effect
  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void (async () => {
      const res = await getRotation();
      if (!active) return;
      if (res.isErr()) {
        setError(res.error);
        setStatuses([]);
      } else {
        setError(null);
        setStatuses(res.value.statuses ?? []);
      }
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [nonce]);

  const byId = useMemo(() => {
    const m = new Map<string, EntityStatus>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);

  return { statuses, byId, isLoading, error, refetch };
}
