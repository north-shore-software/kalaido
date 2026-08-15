import { err, ok, type Result } from "neverthrow";

import {
  getPendingCandidate,
  regenerateProjection,
} from "@/api/kalaidoscope/projections";
import { getRotation, isActionable } from "@/api/kalaidoscope/rotation";

export interface NextTarget {
  id: string;
  type: "projection" | "reflection";
  /** The candidate to review. Always set for projections. */
  snapshotId?: string;
}

/**
 * The next thing worth doing, asked fresh at the moment of the call.
 *
 * Nothing is queued anywhere: `GET /api/rotation` recomputes the whole plan per
 * request and returns it in topological order, so "next" is simply its first
 * actionable entry — work to do, nothing pending upstream. Approving something
 * changes that answer, which is why it is re-asked each time rather than
 * remembered.
 *
 * A projection is only reviewable once it has a candidate, so one is generated
 * here when it doesn't already have one. Returns null when nothing is
 * actionable, i.e. the workspace is caught up.
 */
export async function findNextTarget({
  skip = [],
}: {
  skip?: string[];
} = {}): Promise<Result<NextTarget | null, Error>> {
  const plan = await getRotation();
  if (plan.isErr()) return err(plan.error);

  const next = (plan.value.statuses ?? []).find(
    (s) => isActionable(s) && !skip.includes(s.id),
  );
  if (!next) return ok(null);

  // Reflections publish without a review gate, so there is no candidate to
  // prepare — the caller just opens them.
  if (next.type === "reflection") {
    return ok({ id: next.id, type: "reflection" });
  }

  const pending = await getPendingCandidate(next.id);
  if (pending.isErr()) return err(pending.error);
  if (pending.value) {
    return ok({
      id: next.id,
      type: "projection",
      snapshotId: pending.value.id,
    });
  }

  const generated = await regenerateProjection(next.id);
  if (generated.isErr()) return err(generated.error);
  return ok({
    id: next.id,
    type: "projection",
    snapshotId: generated.value.snapshotId,
  });
}
