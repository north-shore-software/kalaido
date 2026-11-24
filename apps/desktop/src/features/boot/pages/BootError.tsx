import { useSnapshot } from "valtio/react";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { appState } from "@/hooks/use-app-state.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { defineRoute } from "@/routes/route-kit";
import { RecoveryScreen } from "../components/recovery-screen";
import { bootErrorTransitions } from "./BootError.transitions";

export default function BootError() {
  const { appStage } = useSnapshot(appState);

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

export const bootErrorRoute = defineRoute({
  id: "boot-error",
  path: "/boot-error",
  feature: "Boot",
  requiredScope: [],
  transitions: bootErrorTransitions,
  Component: BootError,
});
