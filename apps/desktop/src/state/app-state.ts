import { configureCloudSessionTokenBridge } from "@kalaido/client/cloud/auth";
import { RECOMMENDED_MODEL } from "@kalaido/client/kalaidoscope/llm-config";
import {
  getActiveKalaidoscopeClient,
  setActiveKalaidoscopeClient,
} from "@kalaido/client/lib/active-kalaidoscope-client";
import { isArchived } from "@kalaido/client/lib/active-kalaidoscopes";
import { type StageError, stageError } from "@kalaido/client/lib/errors";
import { subscribeInferenceRate } from "@kalaido/client/lib/inference-rate";
import { createScopeContext } from "@kalaido/hooks/create-scope-context";
import {
  clearCloudLiveCache,
  clearWorkspaceLiveCache,
} from "@kalaido/hooks/kalaidoscope-live";
import { hostSettingsPersistence } from "@kalaido/hooks/scope-persistence";
import type { KalaidoscopeMeta, ThemePreference } from "@kalaido/platform";
import { disposeClientSubscriptions } from "@kalaido/state/pocketbase";
import {
  createScope,
  type PersistedScopeInstance,
  type ScopeHandlers,
} from "@kalaido/state/scope";
import {
  registerSidecarStatusChangeListener,
  type SidecarStatus,
} from "@/api/app/local-scopes.ts";
import type { UnlistenFn } from "@/api/app/os-integrations.ts";
import type { RouteId } from "@/routes/route-ids";

export { type StageError, stageError };

/** Where an opening workspace lands instead of the dashboard. */
export type StageEntry = Extract<RouteId, "onboarding-import">;

export type IdleStageEntry = Extract<
  RouteId,
  "onboarding-login" | "cloud-workspaces"
>;

export type KalaidoscopeErrorSource =
  | "cloud_startup"
  | "local_startup"
  | "restore";

export type AppStage =
  | {
      stage: "bootstrap" | "onboarding_interstitial";
    }
  | {
      stage: "no_kalaidoscopes_available";
      entry?: IdleStageEntry;
    }
  | {
      stage: "kalaidoscope_loading";
      loadKalaidoscopeId?: string;
    }
  | {
      stage: "bootstrap_error";
      error?: StageError;
    }
  | {
      stage: "kalaidoscope_load_error";
      error?: StageError;
      retryKalaidoscopeId?: string;
      source?: KalaidoscopeErrorSource;
    }
  | {
      stage: "kalaidoscope_open";
      selectedKalaidoscopeId: string;
      entry?: StageEntry;
    }
  | {
      stage: "kalaidoscope_load_requested";
      loadKalaidoscopeId: string;
      entry?: StageEntry;
    };

export interface AppState {
  // Persisted settings (written through via hostSettingsPersistence)
  theme: ThemePreference;
  cloudSessionToken?: string;
  localKalaidoscopes: KalaidoscopeMeta[];
  cachedCloudKalaidoscopes: KalaidoscopeMeta[];
  lastOpenedKalaidoscopeId?: string;
  onboardingAcknowledged: boolean;
  errorReportingEnabled: boolean;
  usageStatisticsEnabled: boolean;
  ollamaModel: string;
  sidebarOpen: boolean;

  // Ephemeral app state
  appStage: AppStage;
  sidecarStatus: SidecarStatus;
  latestInferenceRate?: { tokensPerSecond: number; at: number };
  addFragmentModalOpen: boolean;
  feedbackDialogOpen: boolean;
  recentExploreConversationIds: Record<string, string>;
}

export type AppEvent =
  | { readonly type: "setTheme"; readonly theme: ThemePreference }
  | { readonly type: "setCloudSessionToken"; readonly token: string | null }
  | { readonly type: "setOllamaModel"; readonly model: string }
  | { readonly type: "setSidebarOpen"; readonly open: boolean }
  | { readonly type: "setAddFragmentModalOpen"; readonly open: boolean }
  | { readonly type: "setFeedbackDialogOpen"; readonly open: boolean }
  | { readonly type: "recordInferenceRate"; readonly tokensPerSecond: number }
  | { readonly type: "setSidecarStatus"; readonly status: SidecarStatus }
  | { readonly type: "addLocalKalaidoscope"; readonly meta: KalaidoscopeMeta }
  | {
      readonly type: "addCachedCloudKalaidoscope";
      readonly meta: KalaidoscopeMeta;
    }
  | {
      readonly type: "setCachedCloudKalaidoscopes";
      readonly workspaces: KalaidoscopeMeta[];
    }
  | { readonly type: "removeKalaidoscope"; readonly id: string }
  | { readonly type: "setLastOpenedKalaidoscopeId"; readonly id: string | null }
  | { readonly type: "setAppStage"; readonly stage: AppStage }
  | {
      readonly type: "openKalaidoscope";
      readonly id: string;
      readonly entry?: StageEntry;
    }
  | { readonly type: "clearStageEntry" }
  | {
      readonly type: "completeOnboardingInterstitial";
      readonly errorReportingEnabled: boolean;
      readonly usageStatisticsEnabled: boolean;
    }
  | {
      readonly type: "setRecentExploreConversationId";
      readonly workspaceId: string;
      readonly conversationId: string | null;
    }
  | { readonly type: "signOutCloud" };

export type DesktopScopeInstance = PersistedScopeInstance<AppState, AppEvent>;

export const DesktopScopeContext = createScopeContext<AppState, AppEvent>(
  "DesktopScope",
);

const DESKTOP_PERSIST_KEYS = [
  "theme",
  "cloudSessionToken",
  "localKalaidoscopes",
  "cachedCloudKalaidoscopes",
  "lastOpenedKalaidoscopeId",
  "onboardingAcknowledged",
  "errorReportingEnabled",
  "usageStatisticsEnabled",
  "ollamaModel",
  "sidebarOpen",
] as const;

export function allKalaidoscopes(state: {
  readonly localKalaidoscopes: readonly KalaidoscopeMeta[];
  readonly cachedCloudKalaidoscopes: readonly KalaidoscopeMeta[];
}): KalaidoscopeMeta[] {
  return [...state.localKalaidoscopes, ...state.cachedCloudKalaidoscopes];
}

const DEFAULT_SIDECAR_STATUS: SidecarStatus = {
  phase: "idle",
  id: null,
  message: null,
};

const handlers: ScopeHandlers<AppState, AppEvent> = {
  setTheme: (s, e) => {
    s.theme = e.theme;
  },
  setCloudSessionToken: (s, e) => {
    if (e.token === null) {
      delete s.cloudSessionToken;
    } else {
      s.cloudSessionToken = e.token;
    }
  },
  setOllamaModel: (s, e) => {
    s.ollamaModel = e.model;
  },
  setSidebarOpen: (s, e) => {
    s.sidebarOpen = e.open;
  },
  setAddFragmentModalOpen: (s, e) => {
    s.addFragmentModalOpen = e.open;
  },
  setFeedbackDialogOpen: (s, e) => {
    s.feedbackDialogOpen = e.open;
  },
  recordInferenceRate: (s, e) => {
    s.latestInferenceRate = {
      tokensPerSecond: e.tokensPerSecond,
      at: Date.now(),
    };
  },
  setSidecarStatus: (s, e) => {
    s.sidecarStatus = e.status;
  },
  addLocalKalaidoscope: (s, e) => {
    s.localKalaidoscopes = [...s.localKalaidoscopes, e.meta];
  },
  addCachedCloudKalaidoscope: (s, e) => {
    s.cachedCloudKalaidoscopes = [...s.cachedCloudKalaidoscopes, e.meta];
  },
  setCachedCloudKalaidoscopes: (s, e) => {
    s.cachedCloudKalaidoscopes = e.workspaces;
  },
  removeKalaidoscope: (s, e) => {
    s.localKalaidoscopes = s.localKalaidoscopes.filter((k) => k.id !== e.id);
    s.cachedCloudKalaidoscopes = s.cachedCloudKalaidoscopes.filter(
      (k) => k.id !== e.id,
    );
    delete s.recentExploreConversationIds[e.id];
  },
  setLastOpenedKalaidoscopeId: (s, e) => {
    if (e.id === null) {
      delete s.lastOpenedKalaidoscopeId;
    } else {
      s.lastOpenedKalaidoscopeId = e.id;
    }
  },
  setAppStage: (s, e) => {
    s.appStage = e.stage;
  },
  openKalaidoscope: (s, e) => {
    s.appStage = {
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: e.id,
      ...(e.entry && { entry: e.entry }),
    };
  },
  clearStageEntry: (s) => {
    const current = s.appStage;
    if (current.stage !== "kalaidoscope_open" || !current.entry) return;
    s.appStage = {
      stage: "kalaidoscope_open",
      selectedKalaidoscopeId: current.selectedKalaidoscopeId,
    };
  },
  completeOnboardingInterstitial: (s, e) => {
    s.onboardingAcknowledged = true;
    s.errorReportingEnabled = e.errorReportingEnabled;
    s.usageStatisticsEnabled = e.usageStatisticsEnabled;
    s.appStage = { stage: "no_kalaidoscopes_available" };
  },
  setRecentExploreConversationId: (s, e) => {
    if (e.conversationId === null) {
      delete s.recentExploreConversationIds[e.workspaceId];
    } else {
      s.recentExploreConversationIds[e.workspaceId] = e.conversationId;
    }
  },
  signOutCloud: (s) => {
    const cloudIds = new Set(s.cachedCloudKalaidoscopes.map((k) => k.id));
    delete s.cloudSessionToken;
    s.cachedCloudKalaidoscopes = [];
    if (
      s.lastOpenedKalaidoscopeId &&
      (cloudIds.has(s.lastOpenedKalaidoscopeId) ||
        !s.localKalaidoscopes.some((k) => k.id === s.lastOpenedKalaidoscopeId))
    ) {
      delete s.lastOpenedKalaidoscopeId;
    }
    for (const id of cloudIds) {
      delete s.recentExploreConversationIds[id];
    }
  },
};

export const desktopScope: DesktopScopeInstance = createScope({
  initial: (): AppState => ({
    theme: "system",
    localKalaidoscopes: [],
    cachedCloudKalaidoscopes: [],
    onboardingAcknowledged: false,
    errorReportingEnabled: true,
    usageStatisticsEnabled: false,
    ollamaModel: RECOMMENDED_MODEL,
    sidebarOpen: false,
    appStage: { stage: "bootstrap" },
    sidecarStatus: DEFAULT_SIDECAR_STATUS,
    addFragmentModalOpen: false,
    feedbackDialogOpen: false,
    recentExploreConversationIds: {},
  }),
  handlers,
  persist: {
    keys: DESKTOP_PERSIST_KEYS,
    adapter: hostSettingsPersistence(DESKTOP_PERSIST_KEYS),
    onHydrated: (state, result) => {
      if (result.isErr()) {
        console.error("couldn't load stored state: ", result.error);
        state.appStage = {
          stage: "bootstrap_error",
          error: stageError(result.error),
        };
        return;
      }

      state.localKalaidoscopes = (state.localKalaidoscopes ?? []).filter(
        (k) => k.type !== "cloud",
      );
      state.cachedCloudKalaidoscopes = (
        state.cachedCloudKalaidoscopes ?? []
      ).filter((k) => k.type === "cloud");

      const lastOpenedId = state.lastOpenedKalaidoscopeId;
      const lastOpenedArchived = allKalaidoscopes(state).some(
        (k) => k.id === lastOpenedId && isArchived(k),
      );
      state.appStage = !state.onboardingAcknowledged
        ? { stage: "onboarding_interstitial" }
        : lastOpenedId && !lastOpenedArchived
          ? {
              stage: "kalaidoscope_load_requested",
              loadKalaidoscopeId: lastOpenedId,
            }
          : { stage: "no_kalaidoscopes_available" };
    },
  },
});

let pushBridgesActive = false;
let unsubscribeInferenceRate: (() => void) | null = null;
let unlistenSidecarStatus: UnlistenFn | null = null;
let clientOpenSeq = 0;
let pendingClientController: AbortController | null = null;

export function cancelPendingClientOpen(): number {
  clientOpenSeq += 1;
  pendingClientController?.abort();
  pendingClientController = null;
  return clientOpenSeq;
}

export function isCurrentClientOpen(seq: number): boolean {
  return clientOpenSeq === seq;
}

export function registerPendingClientController(
  seq: number,
  controller: AbortController,
): void {
  if (clientOpenSeq !== seq) {
    controller.abort();
    return;
  }
  pendingClientController = controller;
}

export function clearPendingClientController(
  controller: AbortController,
): void {
  if (pendingClientController === controller) {
    pendingClientController = null;
  }
}

export function detachDesktopPushBridges(): void {
  pushBridgesActive = false;
  configureCloudSessionTokenBridge(null);
  unsubscribeInferenceRate?.();
  unsubscribeInferenceRate = null;
  unlistenSidecarStatus?.();
  unlistenSidecarStatus = null;
}

export async function teardownActiveClient({
  cancelPending = true,
}: {
  cancelPending?: boolean;
} = {}): Promise<void> {
  if (cancelPending) {
    cancelPendingClientOpen();
  }
  const prev = getActiveKalaidoscopeClient();
  setActiveKalaidoscopeClient(null);
  if (!prev) return;
  disposeClientSubscriptions(prev);
  prev.cancelAllRequests();
  await clearWorkspaceLiveCache(prev.baseURL);
}

export async function bootstrapDesktopState(): Promise<void> {
  detachDesktopPushBridges();
  pushBridgesActive = true;

  configureCloudSessionTokenBridge({
    get: () => desktopScope.state.cloudSessionToken ?? null,
    onChange: (token) => {
      if (!pushBridgesActive) return;
      void desktopScope
        .dispatch({ type: "setCloudSessionToken", token })
        .catch(() => {});
    },
  });

  unsubscribeInferenceRate = subscribeInferenceRate((tokensPerSecond) => {
    if (!pushBridgesActive) return;
    void desktopScope
      .dispatch({ type: "recordInferenceRate", tokensPerSecond })
      .catch(() => {});
  });

  const sidecarListenerPromise = registerSidecarStatusChangeListener(
    (status) => {
      if (!pushBridgesActive) return;
      void desktopScope
        .dispatch({ type: "setSidecarStatus", status })
        .catch(() => {});
    },
  );

  await Promise.all([
    desktopScope.hydrate(),
    sidecarListenerPromise.then((res) => {
      if (res.isErr()) return;
      if (!pushBridgesActive) {
        res.value();
      } else {
        unlistenSidecarStatus = res.value;
      }
    }),
  ]);
}

export async function prepareDesktopReset(): Promise<void> {
  detachDesktopPushBridges();
  await teardownActiveClient();
  await clearCloudLiveCache();
  desktopScope.dispose();
  await desktopScope.flush();
}
