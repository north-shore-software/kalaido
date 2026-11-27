import { desktopRoutes } from "./definitions";
import type { AnyParams, ParamsArg } from "./route-contracts";
import { ROUTE_IDS, type RouteId } from "./route-ids";
import { buildRoutePath, type RouteDef } from "./route-kit";

export const appRoutes: RouteDef[] = desktopRoutes;

const byId = new Map(appRoutes.map((r) => [r.id, r]));

export function routeById(id: RouteId): RouteDef {
  const def = byId.get(id);
  if (!def) throw new Error(`routeById: no RouteDef registered for "${id}"`);
  return def;
}

/** The params argument of `pathFor`: omitted, optional or required per route. */
type PathForArgs<Id extends RouteId> =
  ParamsArg<Id> extends {
    params: infer P;
  }
    ? [params: P]
    : [params?: ParamsArg<Id>["params"]];

/** The URL of a screen, with the params `RouteContracts` says it takes. */
export function pathFor<Id extends RouteId>(
  id: Id,
  ...[params]: PathForArgs<Id>
): string {
  return buildRoutePath(routeById(id), params as AnyParams | undefined);
}

export type SectionId =
  | "dashboard"
  | "explore"
  | "projections"
  | "reflections"
  | "map"
  | "colours"
  | "fragments"
  | "connections"
  | "status"
  | "settings"
  | "onboarding";

export function sectionForRoute(id: RouteId): SectionId {
  switch (id) {
    case "main":
      return "dashboard";
    case "explore":
      return "explore";
    case "projections":
    case "projection-detail":
    case "projection-review":
    case "new-projection":
      return "projections";
    case "reflections":
    case "new-reflection":
      return "reflections";
    case "map":
      return "map";
    case "colours":
      return "colours";
    case "stream":
      return "fragments";
    case "connections":
    case "import":
      return "connections";
    case "status":
      return "status";
    case "settings":
      return "settings";
    // splash, boot-error and the onboarding/setup routes: everything
    // pre-workspace wears the brand's own section.
    default:
      return "onboarding";
  }
}

/** Registry integrity — throws at startup in dev if a page was forgotten. */
if (import.meta.env.DEV) {
  const missing = ROUTE_IDS.filter((id) => !byId.has(id));
  if (missing.length)
    throw new Error(`registry: missing RouteDefs for: ${missing.join(", ")}`);
  if (byId.size !== appRoutes.length)
    throw new Error("registry: duplicate route ids");
}
