import { SplashScreen } from "@kalaido/components/splash-screen";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { allKalaidoscopes, DesktopScopeContext } from "@/state/app-state.ts";
import { setAppStage } from "@/state/app-state-actions.ts";
import { RecoveryScreen } from "../components/recovery-screen";
import { bootErrorTransitions as transitions } from "./BootError.transitions";

export default function BootError() {
  const { go } = useAppNavigate();
  const root = useScopeContext(DesktopScopeContext);
  const stageScope = useScope({
    from: root,
    state: [
      "appStage",
      "localKalaidoscopes",
      "cachedCloudKalaidoscopes",
      "cloudSessionToken",
    ],
  });
  const {
    appStage,
    localKalaidoscopes,
    cachedCloudKalaidoscopes,
    cloudSessionToken,
  } = useScopeState(stageScope);

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

  const targetId =
    appStage.stage === "kalaidoscope_load_error"
      ? appStage.retryKalaidoscopeId
      : appStage.stage === "kalaidoscope_open"
        ? appStage.selectedKalaidoscopeId
        : undefined;

  const targetMeta = targetId
    ? allKalaidoscopes({ localKalaidoscopes, cachedCloudKalaidoscopes }).find(
        (k) => k.id === targetId,
      )
    : undefined;

  if (targetMeta?.type === "cloud") {
    return (
      <SplashScreen
        workspaceName={targetMeta.displayName}
        statusText="Failed to start cloud container."
        error={
          appStage.stage === "kalaidoscope_load_error"
            ? (appStage.error ?? {
                message: "Could not connect to cloud workspace.",
              })
            : { message: "Could not connect to cloud workspace." }
        }
        onRetry={
          targetId ? () => void switchLocalKalaidoscope(targetId) : undefined
        }
        onBack={() => {
          setAppStage({ stage: "no_kalaidoscopes_available" });
          go(
            cloudSessionToken
              ? transitions.backToCloudWorkspaces
              : transitions.backToOnboarding,
            { replace: true },
          );
        }}
        backLabel="Back"
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
