import { MemoryRouter, Routes } from "react-router-dom";
import { RootErrorBoundary } from "@/components/error-boundary";
import ExploreCompact from "@/features/explore/pages/ExploreCompact";
import CloudSignIn from "@/features/onboarding/pages/CloudSignIn";
import CloudWorkspacePicker from "@/features/onboarding/pages/CloudWorkspacePicker";
import { routeElements } from "./app-router";
import { routeById } from "./registry";
import type { RouteDef } from "./route-kit";
import { StateNavigationListener } from "./router-listeners";

export const companionRoutes: RouteDef[] = [
  routeById("splash"),
  routeById("boot-error"),
  { ...routeById("onboarding-login"), Component: CloudSignIn },
  { ...routeById("cloud-workspaces"), Component: CloudWorkspacePicker },
  { ...routeById("explore"), Component: ExploreCompact },
];

export function CompanionRouter() {
  return (
    <RootErrorBoundary>
      <MemoryRouter>
        <StateNavigationListener />
        <Routes>{routeElements(companionRoutes)}</Routes>
      </MemoryRouter>
    </RootErrorBoundary>
  );
}
