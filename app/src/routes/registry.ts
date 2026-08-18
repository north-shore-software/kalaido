import { ROUTE_IDS, type RouteId } from "./route-ids";
import { buildRoutePath, type RouteDef } from "./route-kit";

import { splashRoute } from "@/features/boot/pages/Splash";
import { bootErrorRoute } from "@/features/boot/pages/BootError";
import { onboardingLandingRoute } from "@/features/onboarding/pages/OnboardingLanding";
import { onboardingLoginRoute } from "@/features/onboarding/pages/OnboardingLogin";
import { cloudWorkspacesRoute } from "@/features/onboarding/pages/CloudWorkspaces";
import { kalaidoscopeSetupRoute } from "@/features/create-kalaidoscope/pages/KalaidoscopeSetup";
import { settingsRoute } from "@/features/settings/pages/Settings";
import { mainRoute } from "@/features/dashboard/pages/Main";
import { streamRoute } from "@/features/fragments/pages/Stream";
import { importRoute } from "@/features/import/pages/Import";
import { projectionsRoute } from "@/features/projections/pages/Projections";
import { projectionDetailRoute } from "@/features/projections/pages/ProjectionDetail";
import { projectionReviewRoute } from "@/features/projections/pages/ProjectionReview";
import { newProjectionRoute } from "@/features/projections/pages/NewProjection";
import { reflectionsRoute } from "@/features/reflections/pages/Reflections";
import { newReflectionRoute } from "@/features/reflections/pages/NewReflection";
import { coloursRoute } from "@/features/colours/pages/Colours";
import { connectionsRoute } from "@/features/connections/pages/Connections";
import { rotationRoute } from "@/features/rotation/pages/Rotation";
import { chatRoute } from "@/features/chat/pages/Chat";

export const appRoutes: RouteDef[] = [
  splashRoute,
  bootErrorRoute,
  onboardingLandingRoute,
  onboardingLoginRoute,
  cloudWorkspacesRoute,
  kalaidoscopeSetupRoute,
  settingsRoute,
  mainRoute,
  streamRoute,
  importRoute,
  projectionsRoute,
  projectionDetailRoute,
  projectionReviewRoute,
  newProjectionRoute,
  reflectionsRoute,
  newReflectionRoute,
  coloursRoute,
  connectionsRoute,
  rotationRoute,
  chatRoute,
];

const byId = new Map(appRoutes.map((r) => [r.id, r]));

export function routeById(id: RouteId): RouteDef {
  const def = byId.get(id);
  if (!def) throw new Error(`routeById: no RouteDef registered for "${id}"`);
  return def;
}

export function pathFor(id: RouteId, params?: Record<string, string>): string {
  return buildRoutePath(routeById(id), params);
}

export type SectionId =
  | "dashboard"
  | "chat"
  | "projections"
  | "reflections"
  | "colours"
  | "fragments"
  | "connections"
  | "settings"
  | "onboarding";

export function sectionForRoute(id: RouteId): SectionId {
  switch (id) {
    case "main":
      return "dashboard";
    case "chat":
      return "chat";
    case "projections":
    case "projection-detail":
    case "projection-review":
    case "new-projection":
    case "rotation":
      return "projections";
    case "reflections":
    case "new-reflection":
      return "reflections";
    case "colours":
      return "colours";
    case "stream":
      return "fragments";
    case "connections":
    case "import":
      return "connections";
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
