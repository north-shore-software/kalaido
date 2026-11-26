import { getActiveKalaidoscopeClient } from "@kalaido/client/lib/active-kalaidoscope-client";
import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import { kalaidoscopeTypeLabel } from "@kalaido/client/lib/labels";
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
import { getHost, type KalaidoscopeMeta } from "@kalaido/platform";
import { ListRow } from "@kalaido/primitives/kalaido";
import { disposeClientSubscriptions } from "@kalaido/state/pocketbase";
import { useScope, useScopeState } from "@kalaido/state/scope";
import type { Result } from "neverthrow";
import { type ReactNode, useEffect } from "react";
import { ExploreCompactScreen } from "#explore";

export function CloudSplashView() {
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  const workspaces = useCloudWorkspacesList();

  useEffect(() => {
    document.documentElement.dataset.section = "onboarding";
  }, []);

  if (
    stage.stage !== "workspace_loading" &&
    stage.stage !== "workspace_load_requested"
  ) {
    return <SplashScreen />;
  }

  const targetId = stage.workspaceId;
  const workspace = targetId
    ? workspaces.find((w) => w.id === targetId)
    : undefined;
  const workspaceName = workspace?.displayName ?? targetId ?? "Cloud workspace";

  return (
    <SplashScreen
      workspaceName={workspaceName}
      statusText="Starting cloud container…"
    />
  );
}

export interface CloudBootErrorViewProps {
  onBeforeClear: () => Promise<void>;
  onOpenWorkspace: (id: string) => Promise<Result<void, Error>>;
  onChooseWorkspace: () => void;
}

export function CloudBootErrorView({
  onBeforeClear,
  onOpenWorkspace,
  onChooseWorkspace,
}: CloudBootErrorViewProps) {
  const root = useScopeContext(CloudRootScopeContext);
  const stageScope = useScope({ from: root, state: ["stage"] });
  const { stage } = useScopeState(stageScope);
  const workspaces = useCloudWorkspacesList();

  useEffect(() => {
    document.documentElement.dataset.section = "onboarding";
  }, []);

  if (stage.stage === "bootstrap_error") {
    return (
      <RecoveryView
        title="Kalaido couldn't load its settings"
        description="Kalaido couldn't read its stored settings. Trying again often works; resetting clears saved state and starts fresh."
        error={stage.error}
        onRetry={() => getHost().reload()}
        onBeforeClear={onBeforeClear}
      />
    );
  }

  const targetId =
    stage.stage === "workspace_load_error" ? stage.workspaceId : undefined;
  const workspace = targetId
    ? workspaces.find((w) => w.id === targetId)
    : undefined;
  const workspaceName = workspace?.displayName ?? targetId;
  const otherWorkspaces = activeKalaidoscopes(workspaces).filter(
    (w) => w.type === "cloud" && w.id !== targetId,
  );

  return (
    <RecoveryView
      title={
        workspaceName
          ? `${workspaceName} couldn't start`
          : "Cloud workspace couldn't start"
      }
      description="The remote cloud container for this workspace didn't start in time. Please try again later, send an error report, or choose a different workspace."
      error={stage.stage === "workspace_load_error" ? stage.error : undefined}
      onRetry={targetId ? () => void onOpenWorkspace(targetId) : undefined}
      allowReset={false}
      reportContext={
        targetId
          ? {
              containerId: workspace?.locator ?? targetId,
              workspaceName,
              kalaidoscopeId: targetId,
              route: "/boot-error",
            }
          : undefined
      }
      secondaryAction={{
        label: "Choose a different workspace",
        onClick: onChooseWorkspace,
      }}
      footer={
        otherWorkspaces.length > 0 ? (
          <OtherCloudWorkspacesList
            workspaces={otherWorkspaces}
            onSelect={(id) => void onOpenWorkspace(id)}
          />
        ) : undefined
      }
    />
  );
}

function OtherCloudWorkspacesList({
  workspaces,
  onSelect,
}: {
  workspaces: readonly KalaidoscopeMeta[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t pt-5">
      <span className="text-label uppercase text-muted-foreground">
        Open a different kalaidoscope
      </span>
      <div className="flex flex-col">
        {workspaces.map((item) => (
          <ListRow
            key={item.id}
            leading={
              <div className="flex size-7 shrink-0 items-center justify-center rounded-none border">
                <span className="text-meta font-medium">
                  {item.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            }
            title={item.displayName}
            subtitle={kalaidoscopeTypeLabel(item.type)}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    </div>
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
