import { CloudErrorBoundary } from "@kalaido/components/cloud-error-boundary";
import { SplashScreen } from "@kalaido/components/splash-screen";
import {
  CloudBootErrorView,
  CloudExploreView,
  CloudSignInScreen,
  CloudWorkspacePickerScreen,
} from "@kalaido/features/auth";
import {
  CloudRootScopeContext,
  pathForCloudStage,
  useCloudWorkspacesList,
} from "@kalaido/hooks/cloud-root-scope";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { type ComponentType, useCallback, useEffect, useRef } from "react";
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
      navigate(pathForCloudStage(stage as CloudStage));
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
  return (
    <CloudExploreView
      onSyncWorkspaces={syncCloudWorkspaces}
      onOpenWorkspace={(id) => openCloudWorkspace(id, { surfaceError: false })}
      onSignOut={signOutOfCloud}
      onBeforeClear={prepareCloudReset}
      renderNotOpen={(to) => <Navigate to={to} replace />}
    />
  );
}

function BootErrorPage() {
  return <CloudBootErrorView onBeforeClear={prepareCloudReset} />;
}

const CLOUD_ROUTES: readonly { path: string; Component: ComponentType }[] = [
  { path: "/", Component: SplashScreen },
  { path: "/splash", Component: SplashScreen },
  { path: "/boot-error", Component: BootErrorPage },
  { path: "/login", Component: LoginPage },
  { path: "/workspaces", Component: WorkspacesPage },
  { path: "/explore", Component: ExplorePage },
];

export function MobileApp() {
  return (
    <CloudErrorBoundary onBeforeClear={prepareCloudReset}>
      <MemoryRouter>
        <StageNavigationListener />
        <Routes>
          {CLOUD_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} Component={r.Component} />
          ))}
        </Routes>
      </MemoryRouter>
    </CloudErrorBoundary>
  );
}
