import BootError from "@/features/boot/pages/BootError";
import { bootErrorTransitions } from "@/features/boot/pages/BootError.transitions";
import Splash from "@/features/boot/pages/Splash";
import { splashTransitions } from "@/features/boot/pages/Splash.transitions";
import Colours from "@/features/colours/pages/Colours";
import { coloursTransitions } from "@/features/colours/pages/Colours.transitions";
import Connections from "@/features/connections/pages/Connections";
import { connectionsTransitions } from "@/features/connections/pages/Connections.transitions";
import KalaidoscopeSetup from "@/features/create-kalaidoscope/pages/KalaidoscopeSetup";
import { kalaidoscopeSetupTransitions } from "@/features/create-kalaidoscope/pages/KalaidoscopeSetup.transitions";
import Main from "@/features/dashboard/pages/Main";
import { mainTransitions } from "@/features/dashboard/pages/Main.transitions";
import Explore from "@/features/explore/pages/Explore";
import { exploreTransitions } from "@/features/explore/pages/Explore.transitions";
import Stream from "@/features/fragments/pages/Stream";
import { streamTransitions } from "@/features/fragments/pages/Stream.transitions";
import Import from "@/features/import/pages/Import";
import { importTransitions } from "@/features/import/pages/Import.transitions";
import MapPage from "@/features/map/pages/Map";
import { mapTransitions } from "@/features/map/pages/Map.transitions";
import CloudWorkspaces from "@/features/onboarding/pages/CloudWorkspaces";
import { cloudWorkspacesTransitions } from "@/features/onboarding/pages/CloudWorkspaces.transitions";
import OnboardingImport from "@/features/onboarding/pages/OnboardingImport";
import { onboardingImportTransitions } from "@/features/onboarding/pages/OnboardingImport.transitions";
import OnboardingInterstitial from "@/features/onboarding/pages/OnboardingInterstitial";
import { onboardingInterstitialTransitions } from "@/features/onboarding/pages/OnboardingInterstitial.transitions";
import OnboardingLanding from "@/features/onboarding/pages/OnboardingLanding";
import { onboardingLandingTransitions } from "@/features/onboarding/pages/OnboardingLanding.transitions";
import OnboardingLogin from "@/features/onboarding/pages/OnboardingLogin";
import { onboardingLoginTransitions } from "@/features/onboarding/pages/OnboardingLogin.transitions";
import OnboardingOrganizing from "@/features/onboarding/pages/OnboardingOrganizing";
import { onboardingOrganizingTransitions } from "@/features/onboarding/pages/OnboardingOrganizing.transitions";
import NewProjection from "@/features/projections/pages/NewProjection";
import { newProjectionTransitions } from "@/features/projections/pages/NewProjection.transitions";
import ProjectionDetail from "@/features/projections/pages/ProjectionDetail";
import { projectionDetailTransitions } from "@/features/projections/pages/ProjectionDetail.transitions";
import ProjectionReview from "@/features/projections/pages/ProjectionReview";
import { projectionReviewTransitions } from "@/features/projections/pages/ProjectionReview.transitions";
import Projections from "@/features/projections/pages/Projections";
import { projectionsTransitions } from "@/features/projections/pages/Projections.transitions";
import ReflectionRefine from "@/features/reflections/pages/ReflectionRefine";
import { reflectionRefineTransitions } from "@/features/reflections/pages/ReflectionRefine.transitions";
import Reflections from "@/features/reflections/pages/Reflections";
import { reflectionsTransitions } from "@/features/reflections/pages/Reflections.transitions";
import Settings from "@/features/settings/pages/Settings";
import { settingsTransitions } from "@/features/settings/pages/Settings.transitions";
import StatusPage from "@/features/status/pages/Status";
import { statusTransitions } from "@/features/status/pages/Status.transitions";
import { defineRoute, type RouteDef } from "./route-kit";

export const desktopRoutes: RouteDef[] = [
  defineRoute({
    id: "splash",
    path: "/splash",
    aliases: ["/"],
    feature: "Boot",
    requiredScope: [],
    transitions: splashTransitions,
    Component: Splash,
  }),
  defineRoute({
    id: "boot-error",
    path: "/boot-error",
    feature: "Boot",
    requiredScope: [],
    transitions: bootErrorTransitions,
    Component: BootError,
  }),
  defineRoute({
    id: "onboarding-interstitial",
    path: "/onboarding/welcome",
    feature: "Onboarding",
    requiredScope: [],
    transitions: onboardingInterstitialTransitions,
    Component: OnboardingInterstitial,
  }),
  defineRoute({
    id: "onboarding-landing",
    path: "/onboarding",
    feature: "Onboarding",
    requiredScope: [],
    transitions: onboardingLandingTransitions,
    Component: OnboardingLanding,
  }),
  defineRoute({
    id: "onboarding-login",
    path: "/onboarding/login",
    feature: "Onboarding",
    requiredScope: [],
    transitions: onboardingLoginTransitions,
    Component: OnboardingLogin,
  }),
  defineRoute({
    id: "cloud-workspaces",
    path: "/onboarding/cloud",
    feature: "Onboarding",
    requiredScope: [],
    transitions: cloudWorkspacesTransitions,
    Component: CloudWorkspaces,
  }),
  defineRoute({
    id: "kalaidoscope-setup",
    path: "/kalaidoscope/setup",
    feature: "Create Kalaidoscope",
    requiredScope: [],
    transitions: kalaidoscopeSetupTransitions,
    Component: KalaidoscopeSetup,
  }),
  defineRoute({
    id: "onboarding-import",
    path: "/onboarding/import",
    feature: "Onboarding",
    requiredScope: ["kalaidoscope"],
    transitions: onboardingImportTransitions,
    Component: OnboardingImport,
  }),
  defineRoute({
    id: "onboarding-organizing",
    path: "/onboarding/organizing/:ingestId",
    feature: "Onboarding",
    requiredScope: ["kalaidoscope"],
    transitions: onboardingOrganizingTransitions,
    Component: OnboardingOrganizing,
  }),
  defineRoute({
    id: "settings",
    path: "/settings/:section?",
    feature: "Settings",
    requiredScope: [],
    transitions: settingsTransitions,
    Component: Settings,
  }),
  defineRoute({
    id: "main",
    path: "/main",
    feature: "Dashboard",
    requiredScope: ["kalaidoscope"],
    transitions: mainTransitions,
    Component: Main,
  }),
  defineRoute({
    id: "stream",
    path: "/stream/:id?",
    feature: "Fragments",
    requiredScope: ["kalaidoscope"],
    transitions: streamTransitions,
    Component: Stream,
  }),
  defineRoute({
    id: "import",
    path: "/import",
    feature: "Import",
    requiredScope: ["kalaidoscope"],
    transitions: importTransitions,
    Component: Import,
  }),
  defineRoute({
    id: "projections",
    path: "/projections",
    feature: "Projections",
    requiredScope: ["kalaidoscope"],
    transitions: projectionsTransitions,
    Component: Projections,
  }),
  defineRoute({
    id: "projection-detail",
    path: "/projections/:id",
    aliases: ["/projections/:id/snapshot/:snapshotId"],
    feature: "Projections",
    requiredScope: ["kalaidoscope"],
    transitions: projectionDetailTransitions,
    Component: ProjectionDetail,
  }),
  defineRoute({
    id: "projection-review",
    path: "/projections/:id/review/:snapshotId",
    feature: "Projections",
    requiredScope: ["kalaidoscope"],
    transitions: projectionReviewTransitions,
    Component: ProjectionReview,
  }),
  defineRoute({
    id: "new-projection",
    path: "/projections/new",
    feature: "Projections",
    requiredScope: ["kalaidoscope"],
    transitions: newProjectionTransitions,
    Component: NewProjection,
  }),
  defineRoute({
    id: "reflections",
    path: "/reflections/:id?",
    aliases: ["/reflections/:id/window/:windowId"],
    feature: "Reflections",
    requiredScope: ["kalaidoscope"],
    transitions: reflectionsTransitions,
    Component: Reflections,
  }),
  defineRoute({
    id: "new-reflection",
    path: "/reflections/new",
    feature: "Reflections",
    requiredScope: ["kalaidoscope"],
    transitions: reflectionRefineTransitions,
    Component: ReflectionRefine,
  }),
  defineRoute({
    id: "refine-reflection",
    path: "/reflections/:id/refine",
    feature: "Reflections",
    requiredScope: ["kalaidoscope"],
    transitions: reflectionRefineTransitions,
    Component: ReflectionRefine,
  }),
  defineRoute({
    id: "colours",
    path: "/colours",
    feature: "Colours",
    requiredScope: ["kalaidoscope"],
    transitions: coloursTransitions,
    Component: Colours,
  }),
  defineRoute({
    id: "connections",
    path: "/connections",
    feature: "Connections",
    requiredScope: ["kalaidoscope"],
    featureFlag: "connections",
    transitions: connectionsTransitions,
    Component: Connections,
  }),
  defineRoute({
    id: "explore",
    path: "/explore",
    aliases: ["/chat"],
    feature: "Explore",
    requiredScope: ["kalaidoscope"],
    transitions: exploreTransitions,
    Component: Explore,
  }),
  defineRoute({
    id: "map",
    path: "/map",
    feature: "Map",
    requiredScope: ["kalaidoscope"],
    transitions: mapTransitions,
    Component: MapPage,
  }),
  defineRoute({
    id: "status",
    path: "/status",
    feature: "Status",
    requiredScope: ["kalaidoscope"],
    transitions: statusTransitions,
    Component: StatusPage,
  }),
];
