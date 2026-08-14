import type { AppStage } from "@/hooks/use-app-state.ts";
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

export function upsertAvailableKalaidoscopes(incoming: KalaidoscopeMeta[]) {
  const byId = new Map(appState.availableKalaidoscopes.map((k) => [k.id, k]));
  for (const meta of incoming) {
    const existing = byId.get(meta.id);
    byId.set(meta.id, existing ? { ...existing, ...meta } : meta);
  }
  appState.availableKalaidoscopes = [...byId.values()];
}

export function setAppStage(stage: AppStage) {
  appState.appStage = stage;
}

export function openKalaidoscope(id: string) {
  appState.appStage = {
    stage: "kalaidoscope_open",
    selectedKalaidoscopeId: id,
  };
}
