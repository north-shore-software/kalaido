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
