import { useMemo } from "react";

import { useCollection } from "@/hooks/use-collection";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";

/** How much of a fragment's content to show before it's an id in disguise. */
const LABEL_MAX = 60;

/**
 * A readable one-line label for a fragment: the opening of its content, which is
 * the only thing that distinguishes one from another (fragments have no names).
 */
export function fragmentLabel(content: string | undefined): string {
  const firstLine = (content ?? "").trim().split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine) return "Empty fragment";
  return firstLine.length > LABEL_MAX
    ? `${firstLine.slice(0, LABEL_MAX)}…`
    : firstLine;
}

/**
 * Labels for fragments pinned by id, keyed by fragment id.
 *
 * Explicit fragment pins travel as bare ids (that is all a stored Context Spec
 * holds), so any surface rendering them has to resolve names itself. Only the
 * named fragments are fetched — the context picker deliberately never loads the
 * whole collection (`use-context-sources.ts`), and a workspace has unboundedly
 * many. Ids that resolve to nothing are simply absent from the map, so callers
 * can fall back rather than render a blank.
 */
export function useFragmentLabels(ids: string[]): Map<string, string> {
  const client = useKalaidoscopeClient();

  // Sorted and joined so a re-render with the same ids in a different order
  // doesn't re-key the query.
  const key = useMemo(() => [...ids].sort().join(","), [ids]);

  const filter = useMemo(() => {
    if (!key) return undefined;
    const wanted = key.split(",");
    return wanted
      .map((id, i) => client.filter(`id = {:f${i}}`, { [`f${i}`]: id }))
      .join(" || ");
  }, [key, client]);

  const { records } = useCollection("fragment", {
    filter,
    fields: "id,content",
    enabled: !!filter,
  });

  return useMemo(() => {
    const m = new Map<string, string>();
    for (const r of records) m.set(r.id, fragmentLabel(r.content));
    return m;
  }, [records]);
}
