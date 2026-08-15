import type { ComponentType } from "react";
import type { AppStage } from "@/hooks/use-app-state.ts";
import type { FeatureFlag } from "@/lib/feature-flags";
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
export type TransitionDef = {
  /** Destination route id. Typo-safe via the RouteId union. */
  to: RouteId;
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
  aliases?: string[];
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

export const defineRoute = (def: RouteDef): RouteDef => def;

export const defineTransitions = <T extends Record<string, TransitionDef>>(
  t: T,
): T => t;

/** Transitions owned by chrome (sidebar, switcher, …) rather than a page. */
export type ChromeTransitions = {
  /** Stable source id for the canvas, e.g. "chrome:nav-sidebar". */
  source: `chrome:${string}`;
  /** Human label for the canvas node. */
  label: string;
  transitions: Record<string, TransitionDef>;
};

export const defineChromeTransitions = (
  source: `chrome:${string}`,
  label: string,
  transitions: Record<string, TransitionDef>,
): ChromeTransitions => ({ source, label, transitions });

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
      return "main";
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
