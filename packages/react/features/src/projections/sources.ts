import type { ContextSpec } from "@kalaido/client/kalaidoscope/chat";
import type { SourceItem, SourceKind } from "@kalaido/components";
import type { ContextSources } from "@kalaido/hooks/use-context-sources";

export type { SourceItem, SourceKind };

export function resolveSources(
  spec: ContextSpec | null,
  sources: ContextSources,
  extraNames?: Map<string, string>,
): SourceItem[] {
  if (!spec || spec.wholeScope) return [];
  const items: SourceItem[] = [];

  if (spec.colourIds?.length) {
    const colourById = new Map(sources.colours.map((o) => [o.id, o]));
    for (const id of spec.colourIds) {
      const c = colourById.get(id);
      items.push({
        kind: "Colour",
        id,
        label: c?.name ?? id,
        swatch: c?.swatch,
      });
    }
  }

  if (spec.sourceProjectionIds?.length) {
    const projectionById = new Map(sources.projections.map((o) => [o.id, o]));
    for (const id of spec.sourceProjectionIds) {
      const p = projectionById.get(id);
      items.push({
        kind: "Projection",
        id,
        label: p?.name ?? extraNames?.get(id) ?? id,
      });
    }
  }

  if (spec.sourceReflectionIds?.length) {
    const reflectionById = new Map(sources.reflections.map((o) => [o.id, o]));
    for (const id of spec.sourceReflectionIds) {
      const r = reflectionById.get(id);
      items.push({
        kind: "Reflection",
        id,
        label: r?.name ?? extraNames?.get(id) ?? id,
      });
    }
  }

  return items;
}
