import type { ContextItem } from "@/api/kalaidoscope/chat";
import {
  isContentPin,
  type ScopeMode,
  scopeModeOf,
  selectionPins,
} from "@/api/kalaidoscope/context-items";
import { withContextItem } from "@/lib/mentions";

/**
 * Pure selection logic for the ContextBar: a scope mode (Full / Summaries /
 * Off) plus pinned items, over the plain `ContextItem[]` every page owns. The
 * canonical forms are documented in `api/kalaidoscope/context-items.ts`.
 */

export interface BarState {
  mode: ScopeMode;
  /** Pinned items, in selection order. */
  pins: ContextItem[];
  /**
   * Any fragment-level pin (fragment, colour, legacy type). These are
   * redundant with Full, so their presence disables that option.
   */
  hasContentPins: boolean;
}

/** Kind pill abbreviations shared by the bar's chips and the transcript dividers. */
export const KIND_ABBREV: Record<string, string> = {
  Colour: "Colour",
  Type: "Type",
  Fragment: "Frag",
  Projection: "Proj",
  Reflection: "Refl",
};

export function deriveBarState(items: ContextItem[]): BarState {
  const pins = selectionPins(items);
  return {
    mode: scopeModeOf(items),
    pins,
    hasContentPins: pins.some(isContentPin),
  };
}

/** Add a pin under the mention rules (`withContextItem`): same path as tagging. */
export const addPin = withContextItem;

/** Remove a pinned item; the markers are left alone. */
export function removePin(
  items: ContextItem[],
  pin: { kind: string; id: string },
): ContextItem[] {
  const next = items.filter(
    (it) => !(it.kind === pin.kind && it.id === pin.id),
  );
  return next.length === items.length ? items : next;
}

/**
 * Why Full cannot be selected right now, or null when it can. `fits` is the
 * pre-flight's verdict on the whole scope: `undefined` while unknown, which
 * does not block.
 */
export function fullBlockedBy(
  state: BarState,
  fits: boolean | undefined,
): "pins" | "size" | null {
  if (state.hasContentPins) return "pins";
  if (fits === false) return "size";
  return null;
}
