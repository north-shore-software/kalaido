import { type EntityStatus, hasDelta } from "@/api/kalaidoscope/rotation";

/**
 * What the reconcile card says: how much judgement is waiting, how much of it
 * the wave has already prepared, and what moved. Derived from the freshness
 * plan plus the live candidate map, so it updates as candidates land.
 */
export interface ReconcileSummary {
  /** Projections with work to do — the ritual's stops. */
  projections: number;
  /** How many of those already have a candidate waiting to be reviewed. */
  ready: number;
  /** Reflections with work to do. They publish without a review gate. */
  reflections: number;
  /** Distinct fragments that no live snapshot has consumed yet. */
  newFragments: number;
  /** The projections' names, in the plan's (upstream-first) order. */
  names: string[];
}

export interface SummarizeInputs {
  /** Latest pending candidate id per projection. */
  candidateByProjection: ReadonlyMap<string, string>;
  nameById: ReadonlyMap<string, string>;
}

export function summarizeReconcile(
  statuses: EntityStatus[],
  { candidateByProjection, nameById }: SummarizeInputs,
): ReconcileSummary {
  const summary: ReconcileSummary = {
    projections: 0,
    ready: 0,
    reflections: 0,
    newFragments: 0,
    names: [],
  };
  const fragments = new Set<string>();
  for (const s of statuses) {
    if (!hasDelta(s)) continue;
    for (const id of s.newFragmentIds ?? []) fragments.add(id);
    if (s.type === "reflection") {
      summary.reflections++;
      continue;
    }
    summary.projections++;
    if (candidateByProjection.has(s.id)) summary.ready++;
    summary.names.push(nameById.get(s.id) ?? "Untitled projection");
  }
  summary.newFragments = fragments.size;
  return summary;
}

/** "Weekly digest", "Weekly digest and Standups", "A, B and 2 more". */
export function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
