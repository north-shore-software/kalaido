import type { ContextItem } from "@/api/kalaidoscope/chat";
import {
  isWholeScopeSelection,
  WHOLE_SCOPE_ITEM,
} from "@/api/kalaidoscope/context-items";

/**
 * Pure selection logic for the ContextBar. The bar renders three controls —
 * colour checkboxes, type checkboxes, and pinned specific items — over the
 * plain `ContextItem[]` every page already owns. The wire semantics are a
 * literal union of everything checked/pinned, with two canonical forms:
 *
 * - Whole scope ("all checked"): an empty list, or the whole-scope marker
 *   (optionally followed by pins). This is the default and serialises to
 *   `wholeScope: true`, so newly created colours/types are included without
 *   re-emitting a spec.
 * - Enumerated: explicit Type/Colour items for every checked box. Entered on
 *   the first uncheck (the full universe minus the unchecked entry is written
 *   out) and left again only when *both* lists are re-checked to full.
 */

export interface BarOption {
  id: string;
  label: string;
  /** A colour's stored value — renders a swatch. */
  value?: string;
}

/** The checkbox universes, adapted from `useContextSources`. */
export interface BarSources {
  types: BarOption[];
  colours: BarOption[];
}

export interface BarState {
  /** Whole-scope-ish selection — renders as everything checked. */
  allScope: boolean;
  /** Only meaningful when `allScope` is false. */
  checkedTypes: ReadonlySet<string>;
  checkedColours: ReadonlySet<string>;
  /** Fragment/Projection/Reflection items, in selection order. */
  pins: ContextItem[];
}

/** Kind pill abbreviations shared by the bar's chips and panels. */
export const KIND_ABBREV: Record<string, string> = {
  Colour: "Colour",
  Type: "Type",
  Fragment: "Frag",
  Projection: "Proj",
  Reflection: "Refl",
};

export function deriveBarState(items: ContextItem[]): BarState {
  const checkedTypes = new Set<string>();
  const checkedColours = new Set<string>();
  const pins: ContextItem[] = [];
  for (const it of items) {
    if (it.kind === "Type") checkedTypes.add(it.id);
    else if (it.kind === "Colour") checkedColours.add(it.id);
    else if (it.kind !== "WholeScope") pins.push(it);
  }
  // The marker wins over any stray Colour/Type items a stored spec may carry
  // (the backend's wholeScope short-circuit does the same); they are dropped
  // on the next toggle, never spontaneously.
  return {
    allScope: isWholeScopeSelection(items),
    checkedTypes,
    checkedColours,
    pins,
  };
}

export function isChecked(
  state: BarState,
  kind: "Type" | "Colour",
  id: string,
): boolean {
  if (state.allScope) return true;
  const set = kind === "Type" ? state.checkedTypes : state.checkedColours;
  return set.has(id);
}

export function toggleType(
  items: ContextItem[],
  id: string,
  sources: BarSources,
): ContextItem[] {
  return toggle(items, "Type", id, sources);
}

export function toggleColour(
  items: ContextItem[],
  id: string,
  sources: BarSources,
): ContextItem[] {
  return toggle(items, "Colour", id, sources);
}

function toggle(
  items: ContextItem[],
  kind: "Type" | "Colour",
  id: string,
  sources: BarSources,
): ContextItem[] {
  const state = deriveBarState(items);
  const opts = kind === "Type" ? sources.types : sources.colours;
  const known =
    opts.some((o) => o.id === id) ||
    (!state.allScope && isChecked(state, kind, id));
  if (!known) return items;

  let types: Set<string>;
  let colours: Set<string>;
  if (state.allScope) {
    // First uncheck: enumerate the full universe, then drop the toggled entry.
    types = new Set(sources.types.map((o) => o.id));
    colours = new Set(sources.colours.map((o) => o.id));
  } else {
    types = new Set(state.checkedTypes);
    colours = new Set(state.checkedColours);
  }
  const set = kind === "Type" ? types : colours;
  if (state.allScope || set.has(id)) set.delete(id);
  else set.add(id);

  return canonicalize(types, colours, state.pins, items, sources);
}

/** Remove a pinned item; a selection reduced to the bare marker collapses to empty. */
export function removePin(
  items: ContextItem[],
  pin: { kind: string; id: string },
): ContextItem[] {
  const next = items.filter(
    (it) => !(it.kind === pin.kind && it.id === pin.id),
  );
  if (next.length === items.length) return items;
  return next.every((it) => it.kind === "WholeScope") ? [] : next;
}

/** Trigger-pill caption for one checkbox list: "all" or "n/m". */
export function summarizeChecked(
  state: BarState,
  kind: "Type" | "Colour",
  opts: BarOption[],
): string {
  if (state.allScope) return "all";
  const set = kind === "Type" ? state.checkedTypes : state.checkedColours;
  const count = opts.filter((o) => set.has(o.id)).length;
  return count === opts.length ? "all" : `${count}/${opts.length}`;
}

function canonicalize(
  types: Set<string>,
  colours: Set<string>,
  pins: ContextItem[],
  prev: ContextItem[],
  sources: BarSources,
): ContextItem[] {
  // Everything unchecked with nothing pinned is the accepted reset-to-default
  // edge: empty serialises to whole scope and the boxes re-check.
  if (types.size === 0 && colours.size === 0 && pins.length === 0) return [];

  // ⊇, not =: stale checked ids whose type/colour no longer exists must not
  // block the collapse back to whole scope (they are dropped with it).
  const fullTypes = sources.types.every((o) => types.has(o.id));
  const fullColours = sources.colours.every((o) => colours.has(o.id));
  if (fullTypes && fullColours) {
    return pins.length > 0 ? [WHOLE_SCOPE_ITEM, ...pins] : [];
  }

  const out: ContextItem[] = [];
  emitChecked(out, "Type", types, sources.types, prev);
  emitChecked(out, "Colour", colours, sources.colours, prev);
  out.push(...pins);
  return out;
}

function emitChecked(
  out: ContextItem[],
  kind: "Type" | "Colour",
  checked: Set<string>,
  opts: BarOption[],
  prev: ContextItem[],
): void {
  const seen = new Set<string>();
  for (const o of opts) {
    if (!checked.has(o.id)) continue;
    seen.add(o.id);
    const item: ContextItem = { kind, id: o.id, label: o.label };
    if (o.value != null) item.value = o.value;
    out.push(item);
  }
  // Checked ids absent from the sources (a stored spec naming a since-deleted
  // colour) stay checked, keeping whatever label they arrived with.
  for (const id of checked) {
    if (seen.has(id)) continue;
    const old = prev.find((it) => it.kind === kind && it.id === id);
    out.push(old ?? { kind, id, label: id });
  }
}
