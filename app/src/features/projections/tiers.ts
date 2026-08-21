import { parseContextSpec } from "@/api/kalaidoscope/chat";
import type { ProjectionResponse } from "@/api/kalaidoscope/types";

export type ProjectionTier = "direct" | "derived" | "composite";

export interface ProjectionTiers<T> {
  direct: T[];
  derived: T[];
  composite: T[];
}

export function tierProjections<T extends ProjectionResponse>(
  projections: T[],
): ProjectionTiers<T> {
  const upstreams = new Map<string, string[]>();
  for (const p of projections) {
    const spec = parseContextSpec(p.current_context_spec);
    upstreams.set(p.id, [
      ...(spec?.sourceProjectionIds ?? []),
      ...(spec?.sourceReflectionIds ?? []),
    ]);
  }

  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(id: string): number {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const ups = upstreams.get(id);
    if (!ups || ups.length === 0 || visiting.has(id)) return 0;
    visiting.add(id);
    let max = 0;
    for (const u of ups) max = Math.max(max, depth(u));
    visiting.delete(id);
    const d = max + 1;
    depths.set(id, d);
    return d;
  }

  const tiers: ProjectionTiers<T> = { direct: [], derived: [], composite: [] };
  for (const p of projections) {
    const d = depth(p.id);
    if (d === 0) tiers.direct.push(p);
    else if (d === 1) tiers.derived.push(p);
    else tiers.composite.push(p);
  }
  return tiers;
}
