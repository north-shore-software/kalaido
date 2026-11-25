import type { KalaidoscopeMeta } from "@kalaido/platform";
import type { SidecarStatus } from "@/api/app/local-scopes.ts";
import {
  type AppStage,
  desktopScope,
  type StageEntry,
} from "@/state/app-state.ts";

export function openAddFragmentModal(): void {
  void desktopScope.dispatch({ type: "setAddFragmentModalOpen", open: true });
}

export function closeAddFragmentModal(): void {
  void desktopScope.dispatch({ type: "setAddFragmentModalOpen", open: false });
}

export function openFeedbackDialog(): void {
  void desktopScope.dispatch({ type: "setFeedbackDialogOpen", open: true });
}

export function closeFeedbackDialog(): void {
  void desktopScope.dispatch({ type: "setFeedbackDialogOpen", open: false });
}

export function setSidecarStatus(status: SidecarStatus): void {
  void desktopScope.dispatch({ type: "setSidecarStatus", status });
}

export function addLocalKalaidoscope(meta: KalaidoscopeMeta): Promise<void> {
  return desktopScope.dispatch({ type: "addLocalKalaidoscope", meta });
}

export function addCachedCloudKalaidoscope(
  meta: KalaidoscopeMeta,
): Promise<void> {
  return desktopScope.dispatch({ type: "addCachedCloudKalaidoscope", meta });
}

export function setCachedCloudKalaidoscopes(
  workspaces: KalaidoscopeMeta[],
): Promise<void> {
  return desktopScope.dispatch({
    type: "setCachedCloudKalaidoscopes",
    workspaces,
  });
}

export function removeRegisteredKalaidoscope(id: string): Promise<void> {
  return desktopScope.dispatch({ type: "removeKalaidoscope", id });
}

export function setLastOpenedKalaidoscopeId(id: string | null): Promise<void> {
  return desktopScope.dispatch({ type: "setLastOpenedKalaidoscopeId", id });
}

export function setAppStage(stage: AppStage): void {
  void desktopScope.dispatch({ type: "setAppStage", stage });
}

export function openKalaidoscope(id: string, entry?: StageEntry): void {
  void desktopScope.dispatch({ type: "openKalaidoscope", id, entry });
}

export function clearStageEntry(): void {
  void desktopScope.dispatch({ type: "clearStageEntry" });
}

export function completeOnboardingInterstitial(prefs: {
  errorReportingEnabled: boolean;
  usageStatisticsEnabled: boolean;
}): Promise<void> {
  return desktopScope.dispatch({
    type: "completeOnboardingInterstitial",
    errorReportingEnabled: prefs.errorReportingEnabled,
    usageStatisticsEnabled: prefs.usageStatisticsEnabled,
  });
}
