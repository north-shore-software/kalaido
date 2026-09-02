import type { ContextItem } from "./chat";

/**
 * Leaf module for the context-selection primitives shared by `chat.ts` and
 * `lib/mentions.ts`. It exists because those two import each other's runtime
 * values (`chat.ts` needs `stripMentions` for previews, mention handling needs
 * the whole-scope marker), and this is the acyclic place both can reach.
 */

/** The id every {@link ContextItem} `WholeScope` marker carries. */
export const WHOLE_SCOPE_ID = "*";

/**
 * The canonical whole-scope marker item. A selection carrying it (or an empty
 * selection) means "the whole kalaidoscope": every colour and type is checked,
 * and pins add to that union rather than replacing it.
 */
export const WHOLE_SCOPE_ITEM: ContextItem = {
  kind: "WholeScope",
  id: WHOLE_SCOPE_ID,
  label: "Whole scope",
};

/**
 * True when this selection means "the whole kalaidoscope": empty, or carrying
 * the {@link WHOLE_SCOPE_ITEM} marker.
 */
export function isWholeScopeSelection(items: ContextItem[]): boolean {
  return items.length === 0 || items.some((it) => it.kind === "WholeScope");
}

/** The id the {@link ContextItem} `Summaries` marker carries. */
export const SUMMARIES_ID = "summaries";

/**
 * The summaries-mode marker: the backend renders the resolved fragments as
 * their annotation rows instead of full bodies and gives the model read tools.
 * Round-trips through `ContextSpec.summaries`. The UI offers it for whole-scope
 * selections only, so it always travels with {@link WHOLE_SCOPE_ITEM}.
 */
export const SUMMARIES_ITEM: ContextItem = {
  kind: "Summaries",
  id: SUMMARIES_ID,
  label: "Use summaries",
};

export function isSummariesSelection(items: ContextItem[]): boolean {
  return items.some((it) => it.kind === "Summaries");
}

/**
 * Flip summaries mode. Turning it on materialises the whole-scope marker so
 * the list never becomes a bare `[Summaries]`, which {@link isWholeScopeSelection}
 * would read as an enumerated selection; turning it off collapses a bare
 * marker back to the empty (default) selection. A no-op on an enumerated
 * selection — summaries is whole-scope-only in the UI.
 */
export function toggleSummaries(items: ContextItem[]): ContextItem[] {
  if (isSummariesSelection(items)) {
    const rest = items.filter((it) => it.kind !== "Summaries");
    return rest.every((it) => it.kind === "WholeScope") ? [] : rest;
  }
  if (!isWholeScopeSelection(items)) return items;
  const rest = items.filter((it) => it.kind !== "WholeScope");
  return [WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, ...rest];
}
