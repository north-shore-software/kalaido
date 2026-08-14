import { useEffect } from "react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { useSnapshot } from "valtio/react";
import { TitleBar } from "@/components/layout/title-bar";
import { type AppStage, appState } from "@/hooks/use-app-state.ts";
import { MenuEventListener, StateNavigationListener } from "./router-listeners";
import { appRoutes, pathFor } from "./registry";
import {
  currentScope,
  missingScope,
  type RouteDef,
  stageEntryRoute,
} from "./route-kit";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client.ts";
import { KalaidoscopeClientContext } from "@/hooks/use-kalaidoscope-client";
import { BootError } from "@/features/boot";
import { RootErrorBoundary } from "@/components/error-boundary";

export function AppRouter() {
  return (
    <RootErrorBoundary>
      <TitleBar />
      <MemoryRouter>
        <StateNavigationListener />
        <MenuEventListener />
        <Routes>
          {appRoutes.flatMap((def) =>
            [def.path, ...(def.aliases ?? [])].map((path) => (
              <Route
                key={`${def.id}:${path}`}
                path={path}
                element={<RouteGatekeeper def={def} />}
              />
            )),
          )}
        </Routes>
      </MemoryRouter>
    </RootErrorBoundary>
  );
}

/**
 * Mount-time scope enforcement. This is the guarantee that makes the canvas
 * trustworthy: no matter how a navigation happened (transition, OS menu event,
 * back button), a page whose requiredScope is unmet cannot render — the user is
 * redirected to the entry route for the current stage.
 */
function RouteGatekeeper({ def }: { def: RouteDef }) {
  const snap = useSnapshot(appState);
  const missing = missingScope(
    def,
    currentScope({ appStage: snap.appStage as AppStage }),
  );

  if (missing.length > 0) {
    console.warn(
      `[gatekeeper] blocked "${def.id}" — missing scope: ${missing.join(", ")}`,
    );
    return (
      <Navigate
        to={pathFor(stageEntryRoute(snap.appStage as AppStage))}
        replace
      />
    );
  }

  const Page = def.Component;

  if (
    def.requiredScope.includes("kalaidoscope") &&
    snap.appStage.stage === "kalaidoscope_open"
  ) {
    return (
      <KalaidoscopeContainer key={snap.appStage.selectedKalaidoscopeId}>
        <Page />
      </KalaidoscopeContainer>
    );
  }
  return <Page />;
}

function KalaidoscopeContainer({ children }: { children: React.ReactNode }) {
  const { appStage } = useSnapshot(appState);

  if (appStage.stage !== "kalaidoscope_open") {
    throw new Error(
      `KalaidoscopeContainer mounted in stage "${appStage.stage}" — expected "kalaidoscope_open".`,
    );
  }

  // Set by switchLocalKalaidoscope before the stage flips to
  // `kalaidoscope_open`, so it's always present here.
  const client = getActiveKalaidoscopeClient();

  useEffect(() => {
    return () => {
      client?.cancelAllRequests();
    };
  }, [client]);

  if (!client) {
    return <BootError />;
  }

  return (
    <KalaidoscopeClientContext.Provider value={client}>
      {children}
    </KalaidoscopeClientContext.Provider>
  );
}
