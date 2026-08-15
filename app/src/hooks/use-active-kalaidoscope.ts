import { useSnapshot } from "valtio/react";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { appState } from "./use-app-state.ts";

/**
 * The kalaidoscope currently open, or null outside a workspace scope (boot,
 * onboarding, setup). Several bits of chrome need to name the active workspace;
 * resolving it in one place keeps them from disagreeing about which one it is.
 */
export function useActiveKalaidoscope(): Readonly<KalaidoscopeMeta> | null {
  const { appStage, availableKalaidoscopes } = useSnapshot(appState);
  if (appStage.stage !== "kalaidoscope_open") return null;
  return (
    availableKalaidoscopes.find(
      (k) => k.id === appStage.selectedKalaidoscopeId,
    ) ?? null
  );
}
