import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useCloudSession } from "@kalaido/hooks/use-cloud-session";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import {
  type AppStage,
  allKalaidoscopes,
  DesktopScopeContext,
  type StageError,
} from "@/state/app-state.ts";
import { setAppStage } from "@/state/app-state-actions.ts";
import { RecoveryScreen } from "../components/recovery-screen";

function resolveTargetId(stage: AppStage): string | undefined {
  if (stage.stage === "kalaidoscope_load_error") {
    return stage.retryKalaidoscopeId;
  }
  if (stage.stage === "kalaidoscope_open") {
    return stage.selectedKalaidoscopeId;
  }
  return undefined;
}

function CloudStartupRecovery({
  targetId,
  targetMeta,
  error,
  signedIn,
}: {
  targetId: string | undefined;
  targetMeta: KalaidoscopeMeta | undefined;
  error: StageError | undefined;
  signedIn: boolean;
}) {
  return (
    <RecoveryScreen
      title={
        targetMeta
          ? `${targetMeta.displayName} couldn't start`
          : "Cloud workspace couldn't start"
      }
      description="The remote cloud container for this workspace didn't start in time. Please try again later, send an error report, or choose a different workspace."
      error={error}
      onRetry={
        targetId ? () => void switchLocalKalaidoscope(targetId) : undefined
      }
      allowReset={false}
      reportContext={
        targetId
          ? {
              containerId: targetMeta?.locator ?? targetId,
              workspaceName: targetMeta?.displayName,
              kalaidoscopeId: targetId,
              route: "/boot-error",
            }
          : undefined
      }
      secondaryAction={{
        label: "Choose a different workspace",
        onClick: () =>
          setAppStage({
            stage: "no_kalaidoscopes_available",
            ...(signedIn ? { entry: "cloud-workspaces" } : {}),
          }),
      }}
      allowSwitch
      excludeKalaidoscopeId={targetId}
    />
  );
}

export default function BootError() {
  const { signedIn } = useCloudSession();
  const root = useScopeContext(DesktopScopeContext);
  const stageScope = useScope({
    from: root,
    state: ["appStage", "localKalaidoscopes", "cachedCloudKalaidoscopes"],
  });
  const { appStage, localKalaidoscopes, cachedCloudKalaidoscopes } =
    useScopeState(stageScope);

  if (appStage.stage === "bootstrap_error") {
    return (
      <RecoveryScreen
        title="Kalaido couldn't load its settings"
        description="Kalaido keeps your kalaidoscopes and preferences in a settings file, and that file couldn't be read. Trying again often works; resetting clears the file and starts fresh."
        error={appStage.error}
        onRetry={() => reloadAppWindow()}
      />
    );
  }

  const targetId = resolveTargetId(appStage);
  const targetMeta = targetId
    ? allKalaidoscopes({ localKalaidoscopes, cachedCloudKalaidoscopes }).find(
        (k) => k.id === targetId,
      )
    : undefined;

  if (
    appStage.stage === "kalaidoscope_load_error" &&
    appStage.source === "cloud_startup"
  ) {
    return (
      <CloudStartupRecovery
        targetId={targetId}
        targetMeta={targetMeta}
        error={appStage.error}
        signedIn={signedIn}
      />
    );
  }

  return (
    <RecoveryScreen
      title="This kalaidoscope failed to start"
      description="Kalaido couldn't start the local backend for this kalaidoscope, so it can't load your data. You can try again, open a different kalaidoscope, or reset the app to start fresh."
      error={
        appStage.stage === "kalaidoscope_load_error"
          ? appStage.error
          : undefined
      }
      onRetry={
        targetId ? () => void switchLocalKalaidoscope(targetId) : undefined
      }
      allowSwitch
      excludeKalaidoscopeId={targetId}
    />
  );
}
