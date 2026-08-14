import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { proxy } from "valtio";
import { getAllSettings } from "@/api/app/settings.ts";
import { toError } from "@/lib/errors.ts";

export type StageError = {
  message: string;
  detail?: string;
};

export type AppStage =
  | {
      stage:
        | "bootstrap"
        | "kalaidoscope_loading"
        | "no_kalaidoscopes_available";
    }
  | {
      stage: "bootstrap_error";
      error?: StageError;
    }
  | {
      stage: "kalaidoscope_load_error";
      error?: StageError;
      retryKalaidoscopeId?: string;
    }
  | {
      stage: "kalaidoscope_open";
      selectedKalaidoscopeId: string;
    }
  | {
      stage: "kalaidoscope_load_requested";
      loadKalaidoscopeId: string;
    };

export function stageError(e: unknown): StageError {
  const error = toError(e);
  return { message: error.message, detail: error.stack };
}

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

  if (storedState.isErr()) {
    console.error("couldn't load stored state: ", storedState.error);
    return {
      appStage: {
        stage: "bootstrap_error",
        error: stageError(storedState.error),
      },
    };
  }

  const lastOpenedId = storedState.value.lastOpenedKalaidoscopeId;
  const appStage: AppStage = lastOpenedId
    ? { stage: "kalaidoscope_load_requested", loadKalaidoscopeId: lastOpenedId }
    : { stage: "no_kalaidoscopes_available" };

  return { ...storedState.value, appStage };
};

export const appState = proxy<AppState>(DEFAULT_STATE);
