import { getActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { type StageError, stageError } from "@kalaido/client/lib/errors";
import { RecoveryView } from "@kalaido/components/recovery-view";
import { SplashScreen } from "@kalaido/components/splash-screen";
import {
  CloudSignInScreen,
  CloudWorkspacePickerScreen,
} from "@kalaido/features/auth";
import { ExploreCompactScreen } from "@kalaido/features/explore";
import { CloudRootScopeContext } from "@kalaido/hooks/cloud-root-scope";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { ActiveKalaidoscopeContext } from "@kalaido/hooks/use-active-kalaidoscope";
import { useCloudWorkspaces } from "@kalaido/hooks/use-cloud-workspaces";
import { KalaidoscopeClientContext } from "@kalaido/hooks/use-kalaidoscope-client";
import { getHost, type KalaidoscopeMeta } from "@kalaido/platform";
import { disposeClientSubscriptions } from "@kalaido/state/pocketbase";
import { useScope, useScopeState } from "@kalaido/state/scope";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  type CloudStage,
  openCloudWorkspace,
  prepareCloudReset,
  signOutOfCloud,
  syncCloudWorkspaces,
} from "./state";

function pathForStage(stage: CloudStage): string {
  switch (stage.stage) {
    case "bootstrap":
    case "workspace_loading":
    case "workspace_load_requested":
      return "/splash";
    case "bootstrap_error":
      return "/boot-error";
    case "signed_out":
    case "workspace_load_error":
      return "/login";
    case "workspace_open":
      return "/explore";
  }
}

function useCloudWorkspacesList(): readonly KalaidoscopeMeta[] {
  const root = useScopeContext(CloudRootScopeContext);
  const wsScope = useScope({
    from: root,
    state: ["cachedCloudKalaidoscopes"],
    events: ["setCachedCloudKalaidoscopes"],
  });
  const { cachedCloudKalaidoscopes } = useScopeState(wsScope);
  const offlineBridge = useMemo(
    () => ({
      read: () => wsScope.state.cachedCloudKalaidoscopes,
      write: (workspaces: KalaidoscopeMeta[]) =>
        wsScope.dispatch({
          type: "setCachedCloudKalaidoscopes",
          workspaces,
        }),
    }),
    [wsScope],
  );
  const live = useCloudWorkspaces({ offlineBridge });
  return live.data ?? cachedCloudKalaidoscopes;
}

class CloudErrorBoundary extends Component<
  { children: ReactNode },
  { error: StageError | null }
> {
  state: { error: StageError | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: stageError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <RecoveryView
        title="Kalaido hit an unexpected error"
        description="Something went wrong while drawing the screen. You can reload or reset settings to start fresh."
        error={this.state.error}
        onRetry={() => getHost().reload()}
        retryLabel="Reload Kalaido"
        onBeforeClear={prepareCloudReset}
      />
    );
  }
}

function StageNavigationListener() {
  const navigate = useNavigate();
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  const handledStage = useRef<string | null>(null);

  useEffect(() => {
    const key =
      stage.stage === "workspace_open"
        ? `${stage.stage}:${stage.workspaceId}`
        : stage.stage;
    if (handledStage.current === key) return;
    handledStage.current = key;

    if (stage.stage === "workspace_load_requested") {
      void openCloudWorkspace(stage.workspaceId, { surfaceError: true });
    } else if (stage.stage !== "bootstrap") {
      navigate(pathForStage(stage as CloudStage));
    }
  }, [stage, navigate]);

  return null;
}

function LoginPage() {
  const navigate = useNavigate();
  const handleSignedIn = useCallback(() => {
    navigate("/workspaces", { replace: true });
  }, [navigate]);

  useEffect(() => {
    document.documentElement.dataset.section = "onboarding";
  }, []);

  return (
    <CloudSignInScreen
      onSignedIn={handleSignedIn}
      onSyncWorkspaces={syncCloudWorkspaces}
    />
  );
}

function WorkspacesPage() {
  const navigate = useNavigate();
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  const workspaces = useCloudWorkspacesList();

  useEffect(() => {
    document.documentElement.dataset.section = "onboarding";
  }, []);

  return (
    <CloudWorkspacePickerScreen
      workspaces={workspaces}
      activeWorkspaceId={
        stage.stage === "workspace_open" ? stage.workspaceId : null
      }
      initialError={
        stage.stage === "workspace_load_error"
          ? (stage.error?.message ?? null)
          : null
      }
      onSyncWorkspaces={syncCloudWorkspaces}
      onOpenWorkspace={(id) => openCloudWorkspace(id, { surfaceError: false })}
      onAlreadyOpen={() => navigate(-1)}
      onSignOut={signOutOfCloud}
    />
  );
}

function ExplorePage() {
  const root = useScopeContext(CloudRootScopeContext);
  const exploreScope = useScope({
    from: root,
    state: ["stage", "recentExploreConversationIds"],
    events: ["setStage", "setRecentExploreConversationId"],
  });
  const { stage, recentExploreConversationIds } = useScopeState(exploreScope);
  const workspaces = useCloudWorkspacesList();
  const client =
    stage.stage === "workspace_open" ? getActiveKalaidoscopeClient() : null;

  useEffect(() => {
    document.documentElement.dataset.section = "explore";
  }, []);

  useEffect(() => {
    return () => {
      if (!client) return;
      disposeClientSubscriptions(client);
      client.cancelAllRequests();
    };
  }, [client]);

  if (stage.stage !== "workspace_open") {
    return <Navigate to={pathForStage(stage as CloudStage)} replace />;
  }

  const activeWorkspace =
    workspaces.find((w) => w.id === stage.workspaceId) ?? null;

  if (!client) {
    return (
      <RecoveryView
        title="Couldn't connect to workspace"
        description="The workspace connection was lost. Reload to reconnect."
        onRetry={() => getHost().reload()}
        onBeforeClear={prepareCloudReset}
      />
    );
  }

  return (
    <KalaidoscopeClientContext.Provider value={client}>
      <ActiveKalaidoscopeContext.Provider value={activeWorkspace}>
        <div data-section="explore" className="contents">
          <ExploreCompactScreen
            key={stage.workspaceId}
            workspaces={workspaces}
            recentConversationId={
              recentExploreConversationIds[stage.workspaceId] ?? null
            }
            onRecentConversationChange={(conversationId) => {
              void exploreScope.dispatch({
                type: "setRecentExploreConversationId",
                workspaceId: stage.workspaceId,
                conversationId,
              });
            }}
            onSyncWorkspaces={syncCloudWorkspaces}
            onSelectWorkspace={async (id) => {
              const result = await openCloudWorkspace(id, {
                surfaceError: false,
              });
              if (result.isErr()) {
                await exploreScope.dispatch({
                  type: "setStage",
                  stage: {
                    stage: "workspace_load_error",
                    error: { message: result.error.message },
                  },
                });
              }
            }}
            onSignOut={signOutOfCloud}
          />
        </div>
      </ActiveKalaidoscopeContext.Provider>
    </KalaidoscopeClientContext.Provider>
  );
}

function BootErrorPage() {
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  return (
    <RecoveryView
      title="Kalaido couldn't load its settings"
      description="Kalaido couldn't read its stored settings. Trying again often works; resetting clears saved state and starts fresh."
      error={stage.stage === "bootstrap_error" ? stage.error : undefined}
      onRetry={() => getHost().reload()}
      onBeforeClear={prepareCloudReset}
    />
  );
}

export function MobileApp() {
  return (
    <CloudErrorBoundary>
      <MemoryRouter>
        <StageNavigationListener />
        <Routes>
          <Route path="/" element={<SplashScreen />} />
          <Route path="/splash" element={<SplashScreen />} />
          <Route path="/boot-error" element={<BootErrorPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/explore" element={<ExplorePage />} />
        </Routes>
      </MemoryRouter>
    </CloudErrorBoundary>
  );
}
