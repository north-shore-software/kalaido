import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import { setActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { createScope } from "@kalaido/state/scope";
import { cleanup, render, screen } from "@testing-library/react";
import type { ContextType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AppStage,
  type AppState,
  DesktopScopeContext,
} from "@/state/app-state.ts";
import { KalaidoscopesSection } from "./kalaidoscopes-section";

vi.mock("./workspace-ai-panel", () => ({
  WorkspaceAiPanel: () => {
    const client = useKalaidoscopeClient();
    return <div>ai-panel:{client.baseURL}</div>;
  },
}));

vi.mock("./workspace-quota-panel", () => ({
  WorkspaceQuotaPanel: () => {
    const client = useKalaidoscopeClient();
    return <div>quota-panel:{client.baseURL}</div>;
  },
}));

vi.mock("./workspace-backups-panel", () => ({
  WorkspaceBackupsPanel: () => {
    const client = useKalaidoscopeClient();
    return <div>backups-panel:{client.baseURL}</div>;
  },
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
    handlers: {},
  }) as unknown as NonNullable<ContextType<typeof DesktopScopeContext>>;
}

function makeMockClient(baseURL: string): TypedPocketBase {
  return {
    baseURL,
    cancelAllRequests: vi.fn(),
  } as unknown as TypedPocketBase;
}

describe("KalaidoscopesSection", () => {
  afterEach(() => {
    cleanup();
    setActiveKalaidoscopeClient(null);
  });

  it("provides KalaidoscopeClientContext to active workspace panels when open", () => {
    setActiveKalaidoscopeClient(makeMockClient(WORKSPACE.locator));
    const scope = makeTestScope({
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: WORKSPACE.id,
    });

    render(
      <DesktopScopeContext.Provider value={scope}>
        <KalaidoscopesSection />
      </DesktopScopeContext.Provider>,
    );

    expect(screen.getByText(WORKSPACE.displayName)).toBeDefined();
    expect(screen.getByText(`ai-panel:${WORKSPACE.locator}`)).toBeDefined();
    expect(screen.getByText(`quota-panel:${WORKSPACE.locator}`)).toBeDefined();
    expect(
      screen.getByText(`backups-panel:${WORKSPACE.locator}`),
    ).toBeDefined();
  });

  it("omits active workspace panels cleanly if activeClient is transiently null", () => {
    setActiveKalaidoscopeClient(null);
    const scope = makeTestScope({
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: WORKSPACE.id,
    });

    render(
      <DesktopScopeContext.Provider value={scope}>
        <KalaidoscopesSection />
      </DesktopScopeContext.Provider>,
    );

    expect(screen.getByText(WORKSPACE.displayName)).toBeDefined();
    expect(screen.queryByText(`ai-panel:${WORKSPACE.locator}`)).toBeNull();
  });

  it("renders stored scopes when no kalaidoscope is open", () => {
    const scope = makeTestScope({ stage: "no_kalaidoscopes_available" });

    render(
      <DesktopScopeContext.Provider value={scope}>
        <KalaidoscopesSection />
      </DesktopScopeContext.Provider>,
    );

    expect(screen.getByText("Other scopes")).toBeDefined();
    expect(screen.getByText(WORKSPACE.displayName)).toBeDefined();
  });
});
