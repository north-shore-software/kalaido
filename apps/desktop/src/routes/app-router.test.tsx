import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import { setActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { createScope } from "@kalaido/state/scope";
import { render, screen } from "@testing-library/react";
import type { ContextType } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AppStage,
  type AppState,
  DesktopScopeContext,
} from "@/state/app-state.ts";
import { RouteGatekeeper } from "./app-router";
import type { RouteDef } from "./route-kit";

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
    handlers: {},
  }) as unknown as NonNullable<ContextType<typeof DesktopScopeContext>>;
}

function makeMockClient(baseURL: string): TypedPocketBase {
  return {
    baseURL,
    cancelAllRequests: vi.fn(),
  } as unknown as TypedPocketBase;
}

function OpenWorkspaceProbe() {
  const ctxClient = useKalaidoscopeClient();
  const active = useActiveKalaidoscope();
  return (
    <div>
      <span>{ctxClient.baseURL}</span>
      <span>{active?.displayName}</span>
    </div>
  );
}

function ActiveWorkspaceProbe() {
  const active = useActiveKalaidoscope();
  return <div>{active ? active.displayName : "no-active-workspace"}</div>;
}

describe("RouteGatekeeper", () => {
  afterEach(() => {
    setActiveKalaidoscopeClient(null);
  });

  it("provides KalaidoscopeClientContext to scope-free routes when a kalaidoscope is open", () => {
    const client = makeMockClient(WORKSPACE.locator);
    setActiveKalaidoscopeClient(client);

    const def: RouteDef = {
      id: "settings",
      path: "/settings/:section?",
      feature: "Settings",
      requiredScope: [],
      transitions: {},
      Component: OpenWorkspaceProbe,
    };

    const scope = makeTestScope({
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: WORKSPACE.id,
    });

    const { unmount } = render(
      <DesktopScopeContext.Provider value={scope}>
        <MemoryRouter initialEntries={["/settings"]}>
          <RouteGatekeeper def={def} />
        </MemoryRouter>
      </DesktopScopeContext.Provider>,
    );

    expect(screen.getByText(WORKSPACE.locator)).toBeDefined();
    expect(screen.getByText(WORKSPACE.displayName)).toBeDefined();
    unmount();
  });

  it("still renders scope-free routes without KalaidoscopeContainer when no kalaidoscope is open", () => {
    const def: RouteDef = {
      id: "settings",
      path: "/settings/:section?",
      feature: "Settings",
      requiredScope: [],
      transitions: {},
      Component: ActiveWorkspaceProbe,
    };

    const scope = makeTestScope({ stage: "no_kalaidoscopes_available" });

    render(
      <DesktopScopeContext.Provider value={scope}>
        <MemoryRouter initialEntries={["/settings"]}>
          <RouteGatekeeper def={def} />
        </MemoryRouter>
      </DesktopScopeContext.Provider>,
    );

    expect(screen.getByText("no-active-workspace")).toBeDefined();
  });
});
