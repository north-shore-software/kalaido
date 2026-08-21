import type { ContextSpec } from "@/api/kalaidoscope/chat";
import type { ContextSources } from "@/hooks/use-context-sources";

export type SourceKind = "Colour" | "Projection" | "Reflection";

export interface SourceItem {
  kind: SourceKind;
  id: string;
  label: string;
  value?: string;
}

export function resolveSources(
  spec: ContextSpec | null,
  sources: ContextSources,
): SourceItem[] {
  if (!spec || spec.wholeScope) return [];
  const items: SourceItem[] = [];
  for (const id of spec.colourIds ?? []) {
    const c = sources.colours.find((o) => o.id === id);
    items.push({ kind: "Colour", id, label: c?.name ?? id, value: c?.value });
  }
  for (const id of spec.sourceProjectionIds ?? []) {
    const p = sources.projections.find((o) => o.id === id);
    items.push({ kind: "Projection", id, label: p?.name ?? id });
  }
  for (const id of spec.sourceReflectionIds ?? []) {
    const r = sources.reflections.find((o) => o.id === id);
    items.push({ kind: "Reflection", id, label: r?.name ?? id });
  }
  return items;
}
