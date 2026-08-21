import type { AppStage, StageEntry } from "@/hooks/use-app-state.ts";
import { appState } from "@/hooks/use-app-state.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";

export function openAddFragmentModal() {
  appState.addFragmentModalOpen = true;
}

export function closeAddFragmentModal() {
  appState.addFragmentModalOpen = false;
}

export function recordInferenceRate(tokensPerSecond: number) {
  appState.latestInferenceRate = { tokensPerSecond, at: Date.now() };
}

export function addAvailableKalaidoscope(meta: KalaidoscopeMeta) {
  appState.availableKalaidoscopes.push(meta);
}

export function setAvailableKalaidoscopes(list: KalaidoscopeMeta[]) {
  appState.availableKalaidoscopes = list;
}

export function setAppStage(stage: AppStage) {
  appState.appStage = stage;
}

export function openKalaidoscope(id: string, entry?: StageEntry) {
  appState.appStage = {
    stage: "kalaidoscope_open",
    selectedKalaidoscopeId: id,
    ...(entry && { entry }),
  };
}

export function clearStageEntry() {
  const current = appState.appStage;
  if (current.stage !== "kalaidoscope_open" || !current.entry) return;
  appState.appStage = {
    stage: "kalaidoscope_open",
    selectedKalaidoscopeId: current.selectedKalaidoscopeId,
  };
}
