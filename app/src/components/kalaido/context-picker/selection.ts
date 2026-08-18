import { WHOLE_SCOPE_ID } from "@/api/kalaidoscope/chat.ts";
import type { ContextItem } from "@/api/kalaidoscope/chat.ts";
import {
  type ContextSelection,
  type Criterion,
  EMPTY_SELECTION,
  type SourceRef,
} from "./types.ts";

/**
 * The lossy boundary between the funnel and the wire format, kept in one place
 * so the losses are countable.
 *
 * `ContextItem[]` is what every call site passes and what `itemsToSpec` folds
 * into a `ContextSpec`. It can say "these things are in the context", and
 * nothing else. Two parts of the funnel therefore do not survive a round-trip:
 *
 *   - **Exclusion.** There is no `exclude*` field, in the TypeScript spec or in
 *     Go's `api.ContextSpec`, so `except` degrades to whole-scope and the named
 *     exclusions are dropped rather than silently inverted into inclusions.
 *   - **`Last N`.** The model requires a window count on every source
 *     Reflection; it exists nowhere in the schema, so it is dropped.
 *
 * Both are UI-only until the backend catches up. They live in component state,
 * which means they do not survive a reload — acceptable while they cannot be
 * persisted at all, and the reason they are listed as stubs rather than shipped.
 */
export function selectionToItems(sel: ContextSelection): ContextItem[] {
  const items: ContextItem[] = [];

  // `except` states its base explicitly rather than leaving it to be inferred
  // from an empty list. That matters as soon as a source is attached: without
  // the marker, "everything, plus this projection" would serialise as "this
  // projection and no fragments at all". The exclusions themselves still cannot
  // be expressed, and emitting them as ordinary criteria would invert the
  // user's meaning, so they are dropped and the base survives.
  if (sel.mode === "except") {
    items.push({
      kind: "WholeScope",
      id: WHOLE_SCOPE_ID,
      label: "Whole scope",
    });
  }

  // `none` contributes no fragments at all, which the absence of both the
  // marker and any criteria already says.
  if (sel.mode === "only") {
    for (const c of sel.criteria) {
      items.push({ kind: c.kind, id: c.id, label: c.label, value: c.value });
    }
  }

  for (const s of sel.sources) {
    items.push({ kind: s.kind, id: s.id, label: s.label });
  }

  return items;
}

/**
 * Rebuild a selection from the items a call site handed us.
 *
 * The mode has to be inferred, because it was never stored. Fragment-level
 * criteria mean the user narrowed to them (`only`); their absence alongside at
 * least one source means the context is built purely from syntheses (`none`);
 * anything else is the default whole scope (`except` with nothing excluded).
 * An `except` spec that *did* have exclusions comes back as a plain whole scope
 * — the exclusions were never written down.
 */
export function itemsToSelection(items: ContextItem[]): ContextSelection {
  if (items.length === 0) return EMPTY_SELECTION;

  const criteria: Criterion[] = [];
  const sources: SourceRef[] = [];

  let wholeScope = false;

  for (const it of items) {
    if (it.kind === "WholeScope") {
      wholeScope = true;
      continue;
    }
    switch (it.kind) {
      case "Colour":
      case "Type":
      case "Fragment":
        criteria.push({
          kind: it.kind,
          id: it.id,
          label: it.label,
          value: it.value,
        });
        break;
      case "Projection":
        sources.push({ kind: it.kind, id: it.id, label: it.label });
        break;
      case "Reflection":
        // No stored `Last N` to recover, so every source Reflection comes back
        // at the default rather than at whatever was chosen last time.
        sources.push({
          kind: it.kind,
          id: it.id,
          label: it.label,
          lastN: DEFAULT_LAST_N,
        });
        break;
    }
  }

  // A stated whole scope wins. Otherwise infer: fragment-level criteria mean
  // the user narrowed to them; their absence alongside a source means the
  // context is built purely from syntheses; anything else is the default.
  const mode = wholeScope
    ? "except"
    : criteria.length > 0
      ? "only"
      : sources.length > 0
        ? "none"
        : "except";

  return { mode, criteria, sources };
}

/** What a source Reflection gets when nothing says otherwise. */
export const DEFAULT_LAST_N = 7;

/**
 * A canonical string for a selection's *wire-visible* content, used to tell
 * whether an incoming `value` prop actually differs from what we are already
 * showing. Deliberately ignores `mode` and `lastN`: they never make it onto the
 * wire, so a difference in them can never be a difference in the prop.
 */
export function selectionKey(sel: ContextSelection): string {
  return itemsKey(selectionToItems(sel));
}

export function itemsKey(items: ContextItem[]): string {
  return items
    .map((it) => `${it.kind}:${it.id}`)
    .sort()
    .join("|");
}

export const sameRef = (
  a: { kind: string; id: string },
  b: { kind: string; id: string },
): boolean => a.kind === b.kind && a.id === b.id;
