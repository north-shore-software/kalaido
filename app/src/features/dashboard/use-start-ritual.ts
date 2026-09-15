import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ReconcileStatus } from "@/api/kalaidoscope/organize";
import { startReconcile } from "@/api/kalaidoscope/reconcile";
import type { EntityStatus } from "@/api/kalaidoscope/rotation";
import {
  findNextTarget,
  type NextTarget,
} from "@/features/rotation/next-target";

/**
 * While a Start is waiting, both plans are re-asked on this cadence. Realtime
 * refetches cover most of the wave's footprint, but a reflection settled in
 * place writes no new row, and a wave with nothing to do writes nothing.
 */
const POLL_MS = 2000;

/**
 * Whether the wave a Start press began (at `startedAt`, ms since epoch) has
 * ended: the server has seen a wave start at or after the press and none is
 * running now. `lastStarted` has second resolution, so the press time is
 * compared at that resolution too.
 */
export function waveEnded(
  startedAt: number,
  now: ReconcileStatus | undefined,
): boolean {
  if (!now || now.running || !now.lastStarted) return false;
  const started = Date.parse(now.lastStarted);
  if (Number.isNaN(started)) return false;
  return started >= Math.floor(startedAt / 1000) * 1000;
}

export interface UseStartRitualOptions {
  statuses: EntityStatus[];
  reconcile: ReconcileStatus | undefined;
  refetchOrganize: () => void;
  refetchRotation: () => void;
  /** The first stop is ready: open it. */
  onTarget: (target: NextTarget) => void;
}

/**
 * The ritual's way in. Start kicks the wave, then waits for the first
 * projection to become reviewable: a projection below a stale reflection is
 * blocked until the wave has settled that reflection, and a projection with
 * no candidate yet joins the wave's generation server-side. The wait ends when
 * a stop opens, when the wave it started has ended with nothing to open (the
 * card shows the current truth), or on an error.
 */
export function useStartRitual({
  statuses,
  reconcile,
  refetchOrganize,
  refetchRotation,
  onTarget,
}: UseStartRitualOptions): { starting: boolean; start: () => Promise<void> } {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const latest = useRef({ reconcile, onTarget, refetchRotation });
  latest.current = { reconcile, onTarget, refetchRotation };

  async function start() {
    if (startedAt !== null) return;
    const pressedAt = Date.now();
    const res = await startReconcile();
    if (res.isErr()) {
      toast.error("Couldn’t start", { description: res.error.message });
      return;
    }
    setStartedAt(pressedAt);
  }

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => {
      refetchOrganize();
      refetchRotation();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [startedAt, refetchOrganize, refetchRotation]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: statuses and reconcile are re-run triggers — every plan update is another chance for the first stop to be ready
  useEffect(() => {
    if (startedAt === null || inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      const next = await findNextTarget({ projectionsOnly: true });
      inFlight.current = false;
      if (next.isErr()) {
        toast.error("Couldn’t start", { description: next.error.message });
        setStartedAt(null);
        return;
      }
      if (next.value) {
        setStartedAt(null);
        latest.current.onTarget(next.value);
        return;
      }
      const now = latest.current.reconcile;
      if (!waveEnded(startedAt, now)) return; // still preparing; wait
      setStartedAt(null);
      latest.current.refetchRotation();
      if (now?.lastError)
        toast.error("Reconcile stopped", { description: now.lastError });
    })();
  }, [startedAt, statuses, reconcile]);

  return { starting: startedAt !== null, start };
}
