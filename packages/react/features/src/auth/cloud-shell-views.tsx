import { getActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { RecoveryView } from "@kalaido/components/recovery-view";
import { SplashScreen } from "@kalaido/components/splash-screen";
import {
  CloudRootScopeContext,
  type CloudStage,
  pathForCloudStage,
  useCloudWorkspacesList,
} from "@kalaido/hooks/cloud-root-scope";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { ActiveKalaidoscopeContext } from "@kalaido/hooks/use-active-kalaidoscope";
import { KalaidoscopeClientContext } from "@kalaido/hooks/use-kalaidoscope-client";
import { getHost } from "@kalaido/platform";
import { disposeClientSubscriptions } from "@kalaido/state/pocketbase";
import { useScope, useScopeState } from "@kalaido/state/scope";
import type { Result } from "neverthrow";
import { type ReactNode, useEffect } from "react";
import { ExploreCompactScreen } from "#explore";

export interface CloudSplashViewProps {
  onOpenWorkspace: (id: string) => Promise<Result<void, Error>>;
  onBackToWorkspaces: () => void;
}

export function CloudSplashView({
  onOpenWorkspace,
  onBackToWorkspaces,
}: CloudSplashViewProps) {
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  const workspaces = useCloudWorkspacesList();

  useEffect(() => {
    document.documentElement.dataset.section = "onboarding";
  }, []);

  if (stage.stage === "bootstrap") {
    return <SplashScreen />;
  }

  const targetId =
    stage.stage === "workspace_loading" ||
    stage.stage === "workspace_load_requested" ||
    stage.stage === "workspace_load_error"
      ? stage.workspaceId
      : undefined;
  const workspace = targetId
    ? workspaces.find((w) => w.id === targetId)
    : undefined;
  const workspaceName = workspace?.displayName ?? targetId ?? "Cloud workspace";

  if (stage.stage === "workspace_load_error") {
    return (
      <SplashScreen
        workspaceName={workspaceName}
        statusText="Failed to start cloud container."
        error={stage.error ?? { message: "Could not connect to workspace." }}
        onRetry={targetId ? () => void onOpenWorkspace(targetId) : undefined}
        onBack={onBackToWorkspaces}
        backLabel="Back to workspaces"
      />
    );
  }

  return (
    <SplashScreen
      workspaceName={workspaceName}
      statusText="Starting cloud container…"
    />
  );
}

export interface CloudBootErrorViewProps {
  onBeforeClear: () => Promise<void>;
}

export function CloudBootErrorView({ onBeforeClear }: CloudBootErrorViewProps) {
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  return (
    <RecoveryView
      title="Kalaido couldn't load its settings"
      description="Kalaido couldn't read its stored settings. Trying again often works; resetting clears saved state and starts fresh."
      error={stage.stage === "bootstrap_error" ? stage.error : undefined}
      onRetry={() => getHost().reload()}
      onBeforeClear={onBeforeClear}
    />
  );
}

export interface CloudExploreViewProps {
  onSyncWorkspaces: () => Promise<Result<void, Error>>;
  onOpenWorkspace: (id: string) => Promise<Result<void, Error>>;
  onSignOut: () => Promise<void>;
  onBeforeClear: () => Promise<void>;
  renderNotOpen: (redirectPath: string) => ReactNode;
}

export function CloudExploreView({
  onSyncWorkspaces,
  onOpenWorkspace,
  onSignOut,
  onBeforeClear,
  renderNotOpen,
}: CloudExploreViewProps) {
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
    return renderNotOpen(pathForCloudStage(stage as CloudStage));
  }

  const activeWorkspace =
    workspaces.find((w) => w.id === stage.workspaceId) ?? null;

  if (!client) {
    return (
      <RecoveryView
        title="Couldn't connect to workspace"
        description="The workspace connection was lost. Reload to reconnect."
        onRetry={() => getHost().reload()}
        onBeforeClear={onBeforeClear}
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
            onSyncWorkspaces={onSyncWorkspaces}
            onSelectWorkspace={async (id) => {
              await onOpenWorkspace(id);
            }}
            onSignOut={onSignOut}
          />
        </div>
      </ActiveKalaidoscopeContext.Provider>
    </KalaidoscopeClientContext.Provider>
  );
}
