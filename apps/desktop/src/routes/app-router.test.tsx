import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import { setActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import {
  KalaidoscopeClientContext,
  useKalaidoscopeClient,
} from "@kalaido/hooks/use-kalaidoscope-client";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { subscribePbCollection } from "@kalaido/state/pocketbase";
import { createScope } from "@kalaido/state/scope";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { type ContextType, useContext } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AppEvent,
  type AppStage,
  type AppState,
  DesktopScopeContext,
} from "@/state/app-state.ts";
import { ActiveWorkspaceProvider, RouteGatekeeper } from "./app-router";
import type { RouteDef } from "./route-kit";

vi.mock("@/features/boot", () => ({
  BootError: () => <div>boot-error-fallback</div>,
}));

const WORKSPACE: KalaidoscopeMeta = {
  id: "ws-1",
  displayName: "My Workspace",
  type: "cloud",
  locator: "https://ws-1.example.test",
};

function makeTestScope(appStage: AppStage) {
  const state: AppState = {
    theme: "system",
    localKalaidoscopes: [],
    cachedCloudKalaidoscopes: [WORKSPACE],
    onboardingAcknowledged: true,
    errorReportingEnabled: false,
    usageStatisticsEnabled: false,
    ollamaModel: "qwen3:8b",
    sidebarOpen: true,
    appStage,
    sidecarStatus: { phase: "idle", id: null, message: null },
    addFragmentModalOpen: false,
    feedbackDialogOpen: false,
    recentExploreConversationIds: {},
  };
  return createScope({
    initial: () => state,
    handlers: {
      setAppStage: (s, e: Extract<AppEvent, { type: "setAppStage" }>) => {
        s.appStage = e.stage;
      },
    },
  }) as unknown as NonNullable<ContextType<typeof DesktopScopeContext>>;
}

function makeMockClient(
  baseURL: string,
  onUnsubscribe?: () => void,
): TypedPocketBase {
  return {
    baseURL,
    cancelAllRequests: vi.fn(),
    collection: vi.fn(() => ({
      subscribe: vi.fn(async () => () => {
        onUnsubscribe?.();
      }),
    })),
  } as unknown as TypedPocketBase;
}

function ScopedRouteProbe() {
  const client = useKalaidoscopeClient();
  const active = useActiveKalaidoscope();
  const navigate = useNavigate();
  return (
    <div>
      <span>scoped-client:{client.baseURL}</span>
      <span>scoped-active:{active?.displayName ?? "none"}</span>
      <button type="button" onClick={() => navigate("/settings")}>
        go-settings
      </button>
    </div>
  );
}

function ScopeFreeRouteProbe() {
  const rawClient = useContext(KalaidoscopeClientContext);
  const active = useActiveKalaidoscope();
  return (
    <div>
      <span>free-client:{rawClient ? rawClient.baseURL : "null"}</span>
      <span>free-active:{active ? active.displayName : "none"}</span>
    </div>
  );
}

function GlobalChromeProbe() {
  const active = useActiveKalaidoscope();
  return <div>chrome-active:{active ? active.displayName : "none"}</div>;
}

const MAIN_DEF: RouteDef = {
  id: "main",
  path: "/main",
  feature: "Dashboard",
  requiredScope: ["kalaidoscope"],
  transitions: {},
  Component: ScopedRouteProbe,
};

const SETTINGS_DEF: RouteDef = {
  id: "settings",
  path: "/settings/:section?",
  feature: "Settings",
  requiredScope: [],
  transitions: {},
  Component: ScopeFreeRouteProbe,
};

describe("ActiveWorkspaceProvider and RouteGatekeeper", () => {
  afterEach(() => {
    cleanup();
    setActiveKalaidoscopeClient(null);
  });

  it("provides client context only to kalaidoscope-scoped routes while sharing active metadata everywhere", () => {
    const client = makeMockClient(WORKSPACE.locator);
    setActiveKalaidoscopeClient(client);

    const scope = makeTestScope({
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: WORKSPACE.id,
    });

    render(
      <DesktopScopeContext.Provider value={scope}>
        <MemoryRouter initialEntries={["/main"]}>
          <ActiveWorkspaceProvider>
            <GlobalChromeProbe />
            <Routes>
              <Route
                path="/main"
                element={<RouteGatekeeper def={MAIN_DEF} />}
              />
              <Route
                path="/settings/:section?"
                element={<RouteGatekeeper def={SETTINGS_DEF} />}
              />
            </Routes>
          </ActiveWorkspaceProvider>
        </MemoryRouter>
      </DesktopScopeContext.Provider>,
    );

    expect(
      screen.getByText(`scoped-client:${WORKSPACE.locator}`),
    ).toBeDefined();
    expect(
      screen.getByText(`scoped-active:${WORKSPACE.displayName}`),
    ).toBeDefined();
    expect(
      screen.getByText(`chrome-active:${WORKSPACE.displayName}`),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "go-settings" }));

    expect(screen.getByText("free-client:null")).toBeDefined();
    expect(
      screen.getByText(`free-active:${WORKSPACE.displayName}`),
    ).toBeDefined();
    expect(
      screen.getByText(`chrome-active:${WORKSPACE.displayName}`),
    ).toBeDefined();
  });

  it("preserves active client subscriptions across route navigation and disposes when the workspace closes", async () => {
    const unsubSpy = vi.fn();
    const client = makeMockClient(WORKSPACE.locator, unsubSpy);
    setActiveKalaidoscopeClient(client);
    subscribePbCollection(client, "fragments", () => {});
    await Promise.resolve();

    const scope = makeTestScope({
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: WORKSPACE.id,
    });

    render(
      <DesktopScopeContext.Provider value={scope}>
        <MemoryRouter initialEntries={["/main"]}>
          <ActiveWorkspaceProvider>
            <Routes>
              <Route
                path="/main"
                element={<RouteGatekeeper def={MAIN_DEF} />}
              />
              <Route
                path="/settings/:section?"
                element={<RouteGatekeeper def={SETTINGS_DEF} />}
              />
            </Routes>
          </ActiveWorkspaceProvider>
        </MemoryRouter>
      </DesktopScopeContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "go-settings" }));

    expect(client.cancelAllRequests).not.toHaveBeenCalled();
    expect(unsubSpy).not.toHaveBeenCalled();

    await act(async () => {
      setActiveKalaidoscopeClient(null);
      await scope.dispatch({
        type: "setAppStage",
        stage: { stage: "no_kalaidoscopes_available" },
      });
    });

    expect(client.cancelAllRequests).toHaveBeenCalledTimes(1);
    expect(unsubSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("free-active:none")).toBeDefined();
  });

  it("renders BootError when client is missing on kalaidoscope-scoped routes, but not on scope-free routes", () => {
    setActiveKalaidoscopeClient(null);

    const scope = makeTestScope({
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: WORKSPACE.id,
    });

    const { unmount } = render(
      <DesktopScopeContext.Provider value={scope}>
        <MemoryRouter initialEntries={["/main"]}>
          <ActiveWorkspaceProvider>
            <Routes>
              <Route
                path="/main"
                element={<RouteGatekeeper def={MAIN_DEF} />}
              />
            </Routes>
          </ActiveWorkspaceProvider>
        </MemoryRouter>
      </DesktopScopeContext.Provider>,
    );

    expect(screen.getByText("boot-error-fallback")).toBeDefined();
    unmount();

    render(
      <DesktopScopeContext.Provider value={scope}>
        <MemoryRouter initialEntries={["/settings"]}>
          <ActiveWorkspaceProvider>
            <Routes>
              <Route
                path="/settings/:section?"
                element={<RouteGatekeeper def={SETTINGS_DEF} />}
              />
            </Routes>
          </ActiveWorkspaceProvider>
        </MemoryRouter>
      </DesktopScopeContext.Provider>,
    );

    expect(screen.queryByText("boot-error-fallback")).toBeNull();
    expect(screen.getByText("free-client:null")).toBeDefined();
  });
});
