import type { ComponentType } from "react";
import type { AppStage } from "@/hooks/use-app-state.ts";
import type { FeatureFlag } from "@/lib/feature-flags";
import type { ParamsOf } from "./route-contracts";
import type { RouteId } from "./route-ids";

/**
 * A scope is something a screen needs to exist before it can mount.
 * Scopes are RESOLVED from real app state in `currentScope` below — a scope key
 * without a resolver clause is a compile error by construction (the switch/checks
 * below must cover it). Extend this union as the app grows (e.g. "auth").
 */
export type ScopeKey = "kalaidoscope";

/**
 * A declared navigation. These objects are the app's ONLY way to navigate
 * (see use-app-navigate.ts), so they can never drift from reality.
 * `trigger`/`when`/`animation` are canvas-facing descriptions attached to the
 * functional object; `to` is functional (resolves the destination).
 */
export type TransitionDef<To extends RouteId = RouteId> = {
  /**
   * Destination route id. Typo-safe via the RouteId union; kept as a literal
   * by `defineTransitions` so `go(...)` can type the params and state the
   * destination takes.
   */
  to: To;
  /** Human trigger, e.g. "Click a stream card". Shown on canvas edges. */
  trigger: string;
  /** Optional constraint note, e.g. "Only when a draft exists". */
  when?: string;
  /** Optional animation/feel note, e.g. "slide-left 250ms". */
  animation?: string;
};

export type RouteDef = {
  id: RouteId;
  /** react-router v7 path pattern. Optional params use `:name?`. */
  path: string;
  /** Extra patterns that resolve to the same screen (e.g. "/" for splash). */
  aliases?: readonly string[];
  /** Canvas swimlane, e.g. "Projections". Use the feature directory name, title-cased. */
  feature: string;
  requiredScope: ScopeKey[];
  /**
   * Gates the screen on a build-time flag. The route stays registered — so the
   * registry invariants and `pathFor` keep working — but the gatekeeper refuses
   * to mount it while the flag is off, which is what makes the feature
   * genuinely unreachable rather than merely unlinked.
   */
  featureFlag?: FeatureFlag;
  transitions: Record<string, TransitionDef>;
  Component: ComponentType;
};

// ---------------------------------------------------------------------------
// Params derived from path patterns — the compile-time half of `RouteContracts`.
// `PatternParams<"/a/:id/:x?">` is `{ id: string; x?: string }`.

type Segments<P extends string> = P extends `${infer Head}/${infer Rest}`
  ? Head | Segments<Rest>
  : P;

type ParamSeg<S extends string> = S extends `:${infer Name}?`
  ? { kind: "optional"; name: Name }
  : S extends `:${infer Name}`
    ? { kind: "required"; name: Name }
    : never;

type RequiredNames<P extends string> = Extract<
  ParamSeg<Segments<P>>,
  { kind: "required" }
>["name"];
type OptionalNames<P extends string> = Extract<
  ParamSeg<Segments<P>>,
  { kind: "optional" }
>["name"];

export type PatternParams<P extends string> = {
  [K in RequiredNames<P>]: string;
} & { [K in OptionalNames<P>]?: string };

/** `& {}` forces the mapped type to display flat in hover text and errors. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Alias params are optional by definition: `selectPattern` picks by presence. */
type AliasParams<A extends readonly string[]> = [A[number]] extends [never]
  ? // biome-ignore lint/complexity/noBannedTypes: no aliases → no extra params
    {}
  : Partial<PatternParams<A[number]>>;

type DerivedParams<
  Path extends string,
  Aliases extends readonly string[],
> = Simplify<PatternParams<Path> & AliasParams<Aliases>>;

type DeclaredParams<Id extends RouteId> = [ParamsOf<Id>] extends [undefined]
  ? // biome-ignore lint/complexity/noBannedTypes: no contract → no params
    {}
  : ParamsOf<Id>;

type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;
type SameShape<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/**
 * Resolves to `unknown` (a no-op in an intersection) when the route's
 * patterns agree with its `RouteContracts` entry; otherwise to an object
 * demanding an impossible `params` member, so the `defineRoute` literal fails
 * to compile with both shapes spelled out in the error.
 */
type ParamsCheck<
  Id extends RouteId,
  Path extends string,
  Aliases extends readonly string[],
> =
  SameKeys<DerivedParams<Path, Aliases>, DeclaredParams<Id>> extends true
    ? SameShape<DerivedParams<Path, Aliases>, DeclaredParams<Id>> extends true
      ? unknown
      : {
          params: [
            "route contract mismatch — patterns give",
            DerivedParams<Path, Aliases>,
            "but RouteContracts declares",
            DeclaredParams<Id>,
          ];
        }
    : {
        params: [
          "route contract mismatch — patterns give",
          DerivedParams<Path, Aliases>,
          "but RouteContracts declares",
          DeclaredParams<Id>,
        ];
      };

/**
 * Register a screen. Generic only to read the literal `id`, `path` and
 * `aliases`, which lets `ParamsCheck` prove the route's `RouteContracts`
 * entry matches its URL shapes; the returned value is a plain `RouteDef`.
 */
export function defineRoute<
  Id extends RouteId,
  const Path extends string,
  const Aliases extends readonly string[] = readonly [],
>(
  def: Omit<RouteDef, "id" | "path" | "aliases"> & {
    id: Id;
    path: Path;
    aliases?: Aliases;
  } & ParamsCheck<Id, Path, Aliases>,
): RouteDef {
  return def;
}

/** `const` so each transition keeps its literal `to` (see `TransitionDef`). */
export const defineTransitions = <
  const T extends Record<string, TransitionDef>,
>(
  t: T,
): T => t;

/** Transitions owned by chrome (sidebar, switcher, …) rather than a page. */
export type ChromeTransitions<
  T extends Record<string, TransitionDef> = Record<string, TransitionDef>,
> = {
  /** Stable source id for the canvas, e.g. "chrome:nav-sidebar". */
  source: `chrome:${string}`;
  /** Human label for the canvas node. */
  label: string;
  transitions: T;
};

export const defineChromeTransitions = <
  const T extends Record<string, TransitionDef>,
>(
  source: `chrome:${string}`,
  label: string,
  transitions: T,
): ChromeTransitions<T> => ({ source, label, transitions });

export function currentScope(state: { appStage: AppStage }): Set<ScopeKey> {
  const scope = new Set<ScopeKey>();
  if (state.appStage.stage === "kalaidoscope_open") scope.add("kalaidoscope");
  return scope;
}

export function missingScope(
  def: Pick<RouteDef, "requiredScope">,
  scope: Set<ScopeKey>,
): ScopeKey[] {
  return def.requiredScope.filter((k) => !scope.has(k));
}

/**
 * Where the app belongs for a given stage. Used by BOTH the stage listener and
 * the gatekeeper fallback, so it can't drift.
 * INVARIANT: the returned route's requiredScope must be satisfiable in that stage
 * ("main" is only returned when the stage is kalaidoscope_open).
 */
export function stageEntryRoute(stage: AppStage): RouteId {
  switch (stage.stage) {
    case "kalaidoscope_open":
      return stage.entry ?? "main";
    case "bootstrap":
    case "kalaidoscope_loading":
    case "kalaidoscope_load_requested":
      return "splash";
    case "bootstrap_error":
    case "kalaidoscope_load_error":
      return "boot-error";
    case "no_kalaidoscopes_available":
      return "onboarding-landing";
  }
}

function patternParams(pattern: string): { name: string; optional: boolean }[] {
  return pattern
    .split("/")
    .filter((seg) => seg.startsWith(":"))
    .map((seg) => {
      const optional = seg.endsWith("?");
      return { name: optional ? seg.slice(1, -1) : seg.slice(1), optional };
    });
}

/**
 * Choose which of the route's patterns (primary path first, then aliases) to
 * build a URL from: eligible patterns have all their required params provided;
 * among those, the one consuming the most provided params wins (ties go to the
 * primary path). Aliases exist precisely so one screen can own several URL
 * shapes (e.g. /projections/:id vs /projections/:id/snapshot/:snapshotId) —
 * selecting by params keeps call sites free of URL knowledge.
 */
export function selectPattern(
  def: Pick<RouteDef, "id" | "path" | "aliases">,
  params: Record<string, string | undefined> = {},
): string {
  const provided = new Set(
    Object.keys(params).filter((k) => params[k] != null),
  );

  let best: { pattern: string; consumed: number } | null = null;
  for (const pattern of [def.path, ...(def.aliases ?? [])]) {
    const names = patternParams(pattern);
    if (names.some((p) => !p.optional && !provided.has(p.name))) continue;
    const consumed = names.filter((p) => provided.has(p.name)).length;
    if (!best || consumed > best.consumed) best = { pattern, consumed };
  }

  if (!best) {
    throw new Error(
      `selectPattern: no pattern of route "${def.id}" is satisfied by params {${[...provided].join(", ")}}`,
    );
  }

  if (import.meta.env.DEV && best.consumed < provided.size) {
    const used = new Set(patternParams(best.pattern).map((p) => p.name));
    const unused = [...provided].filter((k) => !used.has(k));
    console.error(
      `[nav] route "${def.id}": params {${unused.join(", ")}} match no pattern — built "${best.pattern}". ` +
        `Check the call site's params or add an alias to the route.`,
    );
  }

  return best.pattern;
}

export function buildRoutePath(
  def: Pick<RouteDef, "id" | "path" | "aliases">,
  params: Record<string, string | undefined> = {},
): string {
  return buildPath(selectPattern(def, params), params);
}

/** Interpolate params into a route pattern. Unfilled optional segments are dropped. */
export function buildPath(
  pattern: string,
  params: Record<string, string | undefined> = {},
): string {
  const out = pattern
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg;
      const optional = seg.endsWith("?");
      const name = optional ? seg.slice(1, -1) : seg.slice(1);
      const value = params[name];
      if (value == null) {
        if (optional) return null;
        throw new Error(
          `buildPath: missing required param ":${name}" for "${pattern}"`,
        );
      }
      return encodeURIComponent(value);
    })
    .filter((s): s is string => s !== null)
    .join("/");
  return out === "" ? "/" : out;
}
