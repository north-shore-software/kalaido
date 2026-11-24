import { getActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { type StageError, stageError } from "@kalaido/client/lib/errors";
import { RecoveryView } from "@kalaido/components/recovery-view";
import { SplashScreen } from "@kalaido/components/splash-screen";
import {
  CloudSignInScreen,
  CloudWorkspacePickerScreen,
} from "@kalaido/features/auth";
import { ExploreCompactScreen } from "@kalaido/features/explore";
import { ActiveKalaidoscopeContext } from "@kalaido/hooks/use-active-kalaidoscope";
import { KalaidoscopeClientContext } from "@kalaido/hooks/use-kalaidoscope-client";
import { getHost } from "@kalaido/platform";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { useSnapshot } from "valtio/react";
import {
  type CloudStage,
  cloudState,
  openCloudWorkspace,
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
      />
    );
  }
}

function StageNavigationListener() {
  const navigate = useNavigate();
  const { stage } = useSnapshot(cloudState);
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
  const { stage, workspaces } = useSnapshot(cloudState);

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
  const { stage, workspaces } = useSnapshot(cloudState);
  const client =
    stage.stage === "workspace_open" ? getActiveKalaidoscopeClient() : null;

  useEffect(() => {
    document.documentElement.dataset.section = "explore";
  }, []);

  useEffect(() => {
    return () => {
      client?.cancelAllRequests();
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
            onSyncWorkspaces={syncCloudWorkspaces}
            onSelectWorkspace={async (id) => {
              const result = await openCloudWorkspace(id, {
                surfaceError: false,
              });
              if (result.isErr()) {
                cloudState.stage = {
                  stage: "workspace_load_error",
                  error: { message: result.error.message },
                };
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
  const { stage } = useSnapshot(cloudState);
  return (
    <RecoveryView
      title="Kalaido couldn't load its settings"
      description="Kalaido couldn't read its stored settings. Trying again often works; resetting clears saved state and starts fresh."
      error={stage.stage === "bootstrap_error" ? stage.error : undefined}
      onRetry={() => getHost().reload()}
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
