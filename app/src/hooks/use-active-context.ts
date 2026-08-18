import type { UIMessage } from "ai";
import { useMemo } from "react";
import { parseActiveContext, specToItems } from "@/api/kalaidoscope/chat";
import type { ContextItem } from "@/components/kalaido";
import { useContextSources } from "./use-context-sources";
import { useFragmentLabelsQuery } from "./use-fragment-labels";

/**
 * The context selection a resumed conversation was last using: its most recent
 * `context_spec` system message, expanded back into items with display labels
 * resolved (a stored spec holds bare ids). Every spec field round-trips —
 * including fragment pins and the whole-scope marker — so syncing the result
 * back into page state never narrows the context the next turn will send.
 */
export function useActiveContext(messages: UIMessage[]) {
  const sources = useContextSources();

  const raw = useMemo(() => {
    const spec = parseActiveContext(messages);
    return spec ? specToItems(spec) : [];
  }, [messages]);

  const fragmentIds = useMemo(
    () => raw.filter((it) => it.kind === "Fragment").map((it) => it.id),
    [raw],
  );
  const { labels, ready: labelsReady } = useFragmentLabelsQuery(fragmentIds);

  const items = useMemo(
    () =>
      raw.map((it): ContextItem => {
        switch (it.kind) {
          case "Type": {
            const opt = sources.types.find((s) => s.value === it.id);
            return { ...it, label: opt?.label ?? it.id };
          }
          case "Colour": {
            const opt = sources.colours.find((s) => s.id === it.id);
            return {
              ...it,
              label: opt?.name ?? "Unknown Colour",
              value: opt?.value,
            };
          }
          case "Projection": {
            const opt = sources.projections.find((s) => s.id === it.id);
            return { ...it, label: opt?.name ?? "Unknown Projection" };
          }
          case "Reflection": {
            const opt = sources.reflections.find((s) => s.id === it.id);
            return { ...it, label: opt?.name ?? "Unknown Reflection" };
          }
          case "Fragment":
            return { ...it, label: labels.get(it.id) ?? it.id };
          default:
            return it;
        }
      }),
    [raw, sources, labels],
  );

  return {
    items,
    ready: !sources.loading && labelsReady,
  };
}
