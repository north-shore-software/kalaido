import { SplashScreen } from "@kalaido/components/splash-screen";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { allKalaidoscopes, DesktopScopeContext } from "@/state/app-state.ts";

export default function Splash() {
  const root = useScopeContext(DesktopScopeContext);
  const splashScope = useScope({
    from: root,
    state: ["appStage", "localKalaidoscopes", "cachedCloudKalaidoscopes"],
  });
  const { appStage, localKalaidoscopes, cachedCloudKalaidoscopes } =
    useScopeState(splashScope);

  const loadingId =
    appStage.stage === "kalaidoscope_loading" ||
    appStage.stage === "kalaidoscope_load_requested"
      ? appStage.loadKalaidoscopeId
      : undefined;

  const meta = loadingId
    ? allKalaidoscopes({ localKalaidoscopes, cachedCloudKalaidoscopes }).find(
        (k) => k.id === loadingId,
      )
    : undefined;

  if (meta?.type === "cloud") {
    return (
      <SplashScreen
        workspaceName={meta.displayName}
        statusText="Starting cloud container…"
      />
    );
  }

  return <SplashScreen />;
}
