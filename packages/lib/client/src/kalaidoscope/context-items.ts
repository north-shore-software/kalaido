import type { ContextItem } from "./chat";

/**
 * Leaf module for the context-selection primitives shared by `chat.ts` and
 * `lib/mentions.ts`. It exists because those two import each other's runtime
 * values (`chat.ts` needs `stripMentions` for previews, mention handling needs
 * the scope markers), and this is the acyclic place both can reach.
 *
 * A selection is a plain `ContextItem[]` in one of three canonical forms:
 *
 * - **Full**: `[WHOLE_SCOPE_ITEM, ...snapshotPins]` — every fragment in full.
 * - **Summaries**: `[WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, ...pins]` — every
 *   fragment as an annotation row, the pins in full, read tools on demand.
 * - **Off**: `[...pins]` — the pins only; `[]` is "nothing at all".
 *
 * Pins are fragments, colours, projections and reflections. The fragment-level
 * ones (fragment, colour) never appear alongside Full: they would be redundant,
 * so the bar refuses them there and a mention of one is a no-op. Snapshot pins
 * (projection, reflection) coexist with any mode — whole scope resolves
 * fragments only, so a snapshot is never redundant.
 */

/** The id every {@link ContextItem} `WholeScope` marker carries. */
export const WHOLE_SCOPE_ID = "*";

/**
 * The whole-scope marker: every fragment in the kalaidoscope is in the
 * context. Round-trips through `ContextSpec.wholeScope`.
 */
export const WHOLE_SCOPE_ITEM: ContextItem = {
  kind: "WholeScope",
  id: WHOLE_SCOPE_ID,
  label: "Whole scope",
};

/** True when the selection carries the {@link WHOLE_SCOPE_ITEM} marker. */
export function isWholeScopeSelection(items: ContextItem[]): boolean {
  return items.some((it) => it.kind === "WholeScope");
}

/** The id the {@link ContextItem} `Summaries` marker carries. */
export const SUMMARIES_ID = "summaries";

/**
 * The summaries-mode marker: the whole scope renders as annotation rows, the
 * pins stay in full, and the model gets read tools. Round-trips through
 * `ContextSpec.summaries` and always travels with {@link WHOLE_SCOPE_ITEM}.
 */
export const SUMMARIES_ITEM: ContextItem = {
  kind: "Summaries",
  id: SUMMARIES_ID,
  label: "Summaries",
};

export function isSummariesSelection(items: ContextItem[]): boolean {
  return items.some((it) => it.kind === "Summaries");
}

/** How the whole scope is presented to the model. */
export type ScopeMode = "full" | "summaries" | "off";

export function scopeModeOf(items: ContextItem[]): ScopeMode {
  if (!isWholeScopeSelection(items)) return "off";
  return isSummariesSelection(items) ? "summaries" : "full";
}

/** A selection's pins — everything that is not a marker, in order. */
export function selectionPins(items: ContextItem[]): ContextItem[] {
  return items.filter(
    (it) => it.kind !== "WholeScope" && it.kind !== "Summaries",
  );
}

/** A projection or reflection pin — adds a snapshot whole scope never includes. */
export function isSnapshotPin(item: ContextItem): boolean {
  return item.kind === "Projection" || item.kind === "Reflection";
}

/** A fragment-level pin — redundant with Full, meaningful otherwise. */
export function isContentPin(item: ContextItem): boolean {
  return (
    item.kind === "Fragment" || item.kind === "Colour" || item.kind === "Type"
  );
}

/**
 * Re-mark a selection for a mode, keeping its pins. Returns the same array
 * when the mode already holds. Does not police Full against content pins —
 * that is the bar's job (it disables the option); a legacy stored selection
 * may legitimately arrive as Full + pins and must round-trip untouched.
 */
export function setScopeMode(
  items: ContextItem[],
  mode: ScopeMode,
): ContextItem[] {
  if (scopeModeOf(items) === mode) return items;
  const pins = selectionPins(items);
  switch (mode) {
    case "full":
      return [WHOLE_SCOPE_ITEM, ...pins];
    case "summaries":
      return [WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, ...pins];
    case "off":
      return pins;
  }
}
