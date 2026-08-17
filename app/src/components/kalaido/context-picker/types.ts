import type { ContextItem, ContextKind } from "@/api/kalaidoscope/chat.ts";

export type { ContextItem, ContextKind };

/**
 * Which sort of thing is being given a context. It decides which stages exist:
 * a Reflection is a leaf node in the dependency graph, so it can neither consume
 * other syntheses nor be built from them alone.
 */
export type EntityKind = "projection" | "reflection" | "chat";

/**
 * How stage 01 treats the fragment population.
 *
 * - `except` — everything in the workspace, minus the union of the criteria.
 * - `only`   — the union of the criteria, and nothing else.
 * - `none`   — no fragments at all; the sources in stage 02 are the whole context.
 *
 * Only `only` survives a round-trip through `ContextSpec` today — see
 * `selection.ts` for what the other two lose.
 */
export type FragmentMode = "except" | "only" | "none";

/** The three fragment selectors. All work in both directions. */
export type CriterionKind = Extract<
  ContextKind,
  "Colour" | "Type" | "Fragment"
>;

/** The two composition inputs. Additive only — they are not fragments. */
export type SourceKind = Extract<ContextKind, "Projection" | "Reflection">;

/** Focus names individual things, never a population, so no Colour and no Type. */
export type FocusKind = Extract<
  ContextKind,
  "Fragment" | "Projection" | "Reflection"
>;

/**
 * How many of a source Reflection's most recent materialized windows to pull in.
 * `"all"` takes every window that exists. A number is a request, not a promise:
 * the model clamps it to the windows actually materialized.
 */
export type LastN = number | "all";

export interface Criterion {
  kind: CriterionKind;
  /** Record id for Colour/Fragment; the fragment-type enum value for Type. */
  id: string;
  label: string;
  /** A colour's stored `value` (tailwind class / hex / css colour) — Colour only. */
  value?: string;
}

export interface SourceRef {
  kind: SourceKind;
  id: string;
  label: string;
  /**
   * Required on a Reflection, meaningless on a Projection (a Projection has one
   * current snapshot, not a series of windows).
   */
  lastN?: LastN;
}

export interface FocusRef {
  kind: FocusKind;
  id: string;
  label: string;
}

/**
 * The funnel's own model. Richer than the `ContextSpec` it serialises to —
 * `mode` and `lastN` have no representation on the wire yet — so it is held in
 * component state and narrowed at the boundary. See `selection.ts`.
 */
export interface ContextSelection {
  mode: FragmentMode;
  criteria: Criterion[];
  sources: SourceRef[];
  focus: FocusRef[];
}

export const EMPTY_SELECTION: ContextSelection = {
  // An untouched picker means "everything", which is `except` with nothing
  // excluded — the same resolved set the old empty selection produced.
  mode: "except",
  criteria: [],
  sources: [],
  focus: [],
};

/** Stage 02 is absent on a Reflection, and `none` mode with it. */
export function allowsSources(entity: EntityKind): boolean {
  return entity !== "reflection";
}
