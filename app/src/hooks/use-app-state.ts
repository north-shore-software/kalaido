import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { proxy } from "valtio";
import { getAllSettings } from "@/api/app/settings.ts";

export type AppStage =
  | {
      stage:
        | "bootstrap"
        | "bootstrap_error"
        | "kalaidoscope_loading"
        | "kalaidoscope_load_error"
        | "no_kalaidoscopes_available";
    }
  | {
      stage: "kalaidoscope_open";
      selectedKalaidoscopeId: string;
    }
  | {
      stage: "kalaidoscope_load_requested";
      loadKalaidoscopeId: string;
    };

export type AppState = {
  appStage: AppStage;
  lightDarkMode: "light" | "dark";
  availableKalaidoscopes: KalaidoscopeMeta[];
  addFragmentModalOpen: boolean;
  latestInferenceRate?: { tokensPerSecond: number; at: number };
};

const DEFAULT_STATE: AppState = {
  appStage: { stage: "bootstrap" },
  lightDarkMode: "light",
  availableKalaidoscopes: [],
  addFragmentModalOpen: false,
};

export const loadStoredState = async (): Promise<Partial<AppState> | null> => {
  const storedState = await getAllSettings();

  let appStage: AppStage = { stage: "bootstrap_error" };

  if (storedState.isOk()) {
    if (storedState.value.lastOpenedKalaidoscopeId) {
      appStage = {
        stage: "kalaidoscope_load_requested",
        loadKalaidoscopeId: storedState.value.lastOpenedKalaidoscopeId,
      };
    } else if (
      !storedState.value.availableKalaidoscopes ||
      storedState.value.availableKalaidoscopes.length === 0
    ) {
      appStage = { stage: "no_kalaidoscopes_available" };
    }

    return { ...storedState.value, appStage };
  } else {
    console.log("couldn't load stored state: ", storedState.error);
    return { appStage };
  }
};

export const appState = proxy<AppState>(DEFAULT_STATE);
