import { useMemo } from "react";
import type { UIMessage } from "ai";
import type { ContextItem } from "@/components/kalaido";
import { useContextSources } from "./use-context-sources";
import { parseActiveContext } from "@/api/kalaidoscope/chat";

export function useActiveContext(messages: UIMessage[]) {
  const sources = useContextSources();

  const items = useMemo(() => {
    const spec = parseActiveContext(messages);
    if (!spec) return [];

    const out: ContextItem[] = [];
    if (spec.fragmentTypes) {
      for (const t of spec.fragmentTypes) {
        const opt = sources.types.find((s) => s.value === t);
        out.push({ kind: "Type", id: t, label: opt?.label ?? t });
      }
    }
    if (spec.colourIds) {
      for (const c of spec.colourIds) {
        const opt = sources.colours.find((s) => s.id === c);
        out.push({
          kind: "Colour",
          id: c,
          label: opt?.name ?? "Unknown Colour",
          value: opt?.value,
        });
      }
    }
    if (spec.sourceProjectionIds) {
      for (const p of spec.sourceProjectionIds) {
        const opt = sources.projections.find((s) => s.id === p);
        out.push({
          kind: "Projection",
          id: p,
          label: opt?.name ?? "Unknown Projection",
        });
      }
    }
    if (spec.sourceReflectionIds) {
      for (const r of spec.sourceReflectionIds) {
        const opt = sources.reflections.find((s) => s.id === r);
        out.push({
          kind: "Reflection",
          id: r,
          label: opt?.name ?? "Unknown Reflection",
        });
      }
    }
    return out;
  }, [messages, sources]);

  return {
    items,
    ready: !sources.loading,
  };
}
