import { getActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { ActiveKalaidoscopeContext } from "@kalaido/hooks/use-active-kalaidoscope";
import { KalaidoscopeClientContext } from "@kalaido/hooks/use-kalaidoscope-client";
import { disposeClientSubscriptions } from "@kalaido/state/pocketbase";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useEffect } from "react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { RootErrorBoundary } from "@/components/error-boundary";
import { TitleBar } from "@/components/layout/title-bar";
import { BootError } from "@/features/boot";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  allKalaidoscopes,
  type AppStage,
  DesktopScopeContext,
} from "@/state/app-state.ts";
import { appRoutes, pathFor, sectionForRoute } from "./registry";
import {
  currentScope,
  missingScope,
  type RouteDef,
  stageEntryRoute,
} from "./route-kit";
import {
  MenuEventListener,
  MenuFeedbackListener,
  MenuUpdateListener,
  StateNavigationListener,
} from "./router-listeners";

function routeElements(defs: RouteDef[]) {
  return defs.flatMap((def) =>
    [def.path, ...(def.aliases ?? [])].map((path) => (
      <Route
        key={`${def.id}:${path}`}
        path={path}
        element={<RouteGatekeeper def={def} />}
      />
    )),
  );
}

export function AppRouter() {
  return (
    <RootErrorBoundary>
      <TitleBar />
      <MemoryRouter>
        <StateNavigationListener />
        <MenuEventListener />
        <MenuFeedbackListener />
        <MenuUpdateListener />
        <Routes>{routeElements(appRoutes)}</Routes>
      </MemoryRouter>
    </RootErrorBoundary>
  );
}

/**
 * Mount-time scope enforcement. This is the guarantee that makes the canvas
 * trustworthy: no matter how a navigation happened (transition, OS menu event,
 * back button), a page whose requiredScope is unmet cannot render — the user is
 * redirected to the entry route for the current stage.
 *
 * The same gate enforces feature flags, so a withheld feature is unreachable by
 * any route into it, not just unlinked from the sidebar.
 */
export function RouteGatekeeper({ def }: { def: RouteDef }) {
  const root = useScopeContext(DesktopScopeContext);
  const stageScope = useScope({ from: root, state: ["appStage"] });
  const { appStage } = useScopeState(stageScope);
  const section = sectionForRoute(def.id);

  useEffect(() => {
    document.documentElement.dataset.section = section;
  }, [section]);

  if (def.featureFlag && !isFeatureEnabled(def.featureFlag)) {
    return (
      <Navigate to={pathFor(stageEntryRoute(appStage as AppStage))} replace />
    );
  }

  const missing = missingScope(
    def,
    currentScope({ appStage: appStage as AppStage }),
  );

  if (missing.length > 0) {
    console.warn(
      `[gatekeeper] blocked "${def.id}" — missing scope: ${missing.join(", ")}`,
    );
    return (
      <Navigate to={pathFor(stageEntryRoute(appStage as AppStage))} replace />
    );
  }

  const Page = def.Component;

  if (appStage.stage === "kalaidoscope_open") {
    return (
      <KalaidoscopeContainer key={appStage.selectedKalaidoscopeId}>
        <div data-section={section} className="contents">
          <Page />
        </div>
      </KalaidoscopeContainer>
    );
  }
  return (
    <div data-section={section} className="contents">
      <Page />
    </div>
  );
}

function KalaidoscopeContainer({ children }: { children: React.ReactNode }) {
  const root = useScopeContext(DesktopScopeContext);
  const containerScope = useScope({
    from: root,
    state: ["appStage", "localKalaidoscopes", "cachedCloudKalaidoscopes"],
  });
  const { appStage, localKalaidoscopes, cachedCloudKalaidoscopes } =
    useScopeState(containerScope);

  if (appStage.stage !== "kalaidoscope_open") {
    throw new Error(
      `KalaidoscopeContainer mounted in stage "${appStage.stage}" — expected "kalaidoscope_open".`,
    );
  }

  const client = getActiveKalaidoscopeClient();
  const activeMeta =
    allKalaidoscopes({ localKalaidoscopes, cachedCloudKalaidoscopes }).find(
      (k) => k.id === appStage.selectedKalaidoscopeId,
    ) ?? null;

  useEffect(() => {
    return () => {
      if (!client) return;
      disposeClientSubscriptions(client);
      client.cancelAllRequests();
    };
  }, [client]);

  if (!client) {
    return <BootError />;
  }

  return (
    <KalaidoscopeClientContext.Provider value={client}>
      <ActiveKalaidoscopeContext.Provider value={activeMeta}>
        {children}
      </ActiveKalaidoscopeContext.Provider>
    </KalaidoscopeClientContext.Provider>
  );
}
