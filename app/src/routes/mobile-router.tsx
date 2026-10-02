import { MemoryRouter, Routes } from "react-router-dom";
import { RootErrorBoundary } from "@/components/error-boundary";
import { bootErrorRoute } from "@/features/boot/pages/BootError";
import { splashRoute } from "@/features/boot/pages/Splash";
import { exploreRoute } from "@/features/explore/pages/Explore";
import ExploreCompact from "@/features/explore/pages/ExploreCompact";
import CloudSignIn from "@/features/onboarding/pages/CloudSignIn";
import CloudWorkspacePicker from "@/features/onboarding/pages/CloudWorkspacePicker";
import { cloudWorkspacesRoute } from "@/features/onboarding/pages/CloudWorkspaces";
import { onboardingLoginRoute } from "@/features/onboarding/pages/OnboardingLogin";
import { routeElements } from "./app-router";
import type { RouteDef } from "./route-kit";
import { StateNavigationListener } from "./router-listeners";

const mobileRoutes: RouteDef[] = [
  splashRoute,
  bootErrorRoute,
  { ...onboardingLoginRoute, Component: CloudSignIn },
  { ...cloudWorkspacesRoute, Component: CloudWorkspacePicker },
  { ...exploreRoute, Component: ExploreCompact },
];

export function MobileRouter() {
  return (
    <RootErrorBoundary>
      <MemoryRouter>
        <StateNavigationListener />
        <Routes>{routeElements(mobileRoutes)}</Routes>
      </MemoryRouter>
    </RootErrorBoundary>
  );
}
