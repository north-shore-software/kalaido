import type { Result } from "neverthrow";

export type AppVariant = "desktop" | "mobile" | "web";

export type KalaidoscopeMeta = {
  id: string;
  type: "local_file" | "cloud" | "local_net";
  locator: string;
  displayName: string;
  icon?: string;
  archivedAt?: string;
};

export type ThemePreference = "light" | "dark" | "system";

export type PersistentAppSetting = {
  theme: ThemePreference;
  cloudSessionToken: string;
  localKalaidoscopes: KalaidoscopeMeta[];
  cachedCloudKalaidoscopes: KalaidoscopeMeta[];
  onboardingAcknowledged: boolean;
  errorReportingEnabled: boolean;
  usageStatisticsEnabled: boolean;
  lastOpenedKalaidoscopeId: string;
  ollamaModel: string;
  sidebarOpen: boolean;
};

export interface SettingsStore {
  get<K extends keyof PersistentAppSetting>(
    key: K,
  ): Promise<Result<PersistentAppSetting[K] | undefined, Error>>;
  getAll(): Promise<Result<Partial<PersistentAppSetting>, Error>>;
  set<K extends keyof PersistentAppSetting>(
    key: K,
    value: PersistentAppSetting[K],
  ): Promise<Result<void, Error>>;
  delete(key: keyof PersistentAppSetting): Promise<Result<void, Error>>;
  clear(): Promise<Result<void, Error>>;
}

export interface ClipboardAdapter {
  writeHtml(html: string, altText: string): Promise<Result<void, Error>>;
}

export interface FeedbackContext {
  kalaidoscopeId: string | null;
  kalaidoscopeType: KalaidoscopeMeta["type"] | null;
  route: string;
}

export interface FeedbackDiagnostics {
  appVersion: string;
  os: string;
  arch: string;
  variant: AppVariant;
  route: string;
  kalaidoscopeType: KalaidoscopeMeta["type"] | null;
  sidecarPhase: string | null;
  sidecarLog: string[];
}

export interface DiagnosticsAdapter {
  collect(
    context: FeedbackContext,
  ): Promise<Result<FeedbackDiagnostics, Error>>;
}

export type UnlistenFn = () => void;

export interface FileDialogFilter {
  name: string;
  extensions: string[];
}

export interface DialogsAdapter {
  openFile(filters?: FileDialogFilter[]): Promise<Result<string | null, Error>>;
  openDirectory(): Promise<Result<string | null, Error>>;
  saveFile(
    defaultPath?: string,
    filters?: FileDialogFilter[],
  ): Promise<Result<string | null, Error>>;
}

export interface MenuEventsAdapter {
  onNavigate(cb: (path: string) => void): Promise<Result<UnlistenFn, Error>>;
  onFeedback(cb: () => void): Promise<Result<UnlistenFn, Error>>;
  onCheckUpdates(cb: () => void): Promise<Result<UnlistenFn, Error>>;
}

export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
}

export type UpdateCheckResult =
  | { status: "available"; update: UpdateMetadata }
  | { status: "up_to_date" }
  | { status: "unsupported" };

export interface UpdaterAdapter {
  check(): Promise<Result<UpdateCheckResult, Error>>;
  install(): Promise<Result<void, Error>>;
}

export type LocalFileKind = "text" | "docx" | "other";

export interface LocalFileEntry {
  path: string;
  kind: LocalFileKind;
}

export interface LocalFilesAdapter {
  classifyPath(path: string): Promise<Result<LocalFileEntry[], Error>>;
  readBytes(path: string): Promise<Result<ArrayBuffer, Error>>;
  downloadToFile(
    url: string,
    headers: Record<string, string>,
    destPath: string,
  ): Promise<Result<void, Error>>;
}

export type SidecarPhase =
  | "idle"
  | "spawning"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface SidecarStatus {
  phase: SidecarPhase;
  id: string | null;
  message: string | null;
  port?: number | null;
}

export interface SidecarCreationDetails {
  path: string;
}

export interface SidecarAdapter {
  onStatusChange(
    cb: (status: SidecarStatus) => void,
  ): Promise<Result<UnlistenFn, Error>>;
  create(
    kalaidoscopeId: string,
    dataDir?: string,
  ): Promise<Result<SidecarCreationDetails, Error>>;
  start(dataDir: string): Promise<Result<void, Error>>;
  stop(kalaidoscopeId: string): Promise<Result<void, Error>>;
  delete(dataDir: string): Promise<Result<void, Error>>;
  getStatus(kalaidoscopeId: string): Promise<Result<SidecarStatus, Error>>;
  getAuthToken(kalaidoscopeId: string): Promise<Result<string, Error>>;
}

export type LlmValidateErrorKind = "auth" | "quota" | "transient" | "other";

export interface LlmValidateKeyResult {
  ok: boolean;
  kind?: LlmValidateErrorKind;
  provider?: string;
  model?: string;
  detail?: string;
}

export interface LlmValidateKeyParams {
  provider: string;
  apiKey: string;
  model: string;
}

export interface OllamaReachability {
  reachable: boolean;
}

export interface LocalLlmAdapter {
  checkOllamaStatus(): Promise<Result<OllamaReachability, Error>>;
  validateKey(
    params: LlmValidateKeyParams,
  ): Promise<Result<LlmValidateKeyResult, Error>>;
}

export interface HostAdapter {
  readonly variant: AppVariant;
  readonly settings: SettingsStore;
  readonly clipboard: ClipboardAdapter;
  readonly diagnostics: DiagnosticsAdapter;
  readonly dialogs?: DialogsAdapter;
  readonly menu?: MenuEventsAdapter;
  readonly updater?: UpdaterAdapter;
  readonly files?: LocalFilesAdapter;
  readonly sidecar?: SidecarAdapter;
  readonly llm?: LocalLlmAdapter;
  openExternalUrl(url: string): Promise<Result<void, Error>>;
  reload(): void;
}

export type DesktopHostAdapter = HostAdapter &
  Required<
    Pick<
      HostAdapter,
      "dialogs" | "menu" | "updater" | "files" | "sidecar" | "llm"
    >
  >;

export interface UnsupportedActionBatch {
  count: number;
  actions: string[];
  title: string;
  description: string;
  onClose: () => void;
}

export function createDebouncedActionReporter(
  onBatch: (batch: UnsupportedActionBatch) => void,
  debounceMs = 100,
): {
  report: (action: string) => void;
  reset: () => void;
} {
  let displayedCount = 0;
  let pendingCount = 0;
  const displayedActions = new Set<string>();
  const pendingActions = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onClose = () => {
    displayedCount = 0;
    displayedActions.clear();
  };

  const reset = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    displayedCount = 0;
    pendingCount = 0;
    displayedActions.clear();
    pendingActions.clear();
  };

  const flush = () => {
    timer = null;
    if (pendingCount === 0) return;

    displayedCount += pendingCount;
    for (const action of pendingActions) {
      displayedActions.add(action);
    }
    pendingCount = 0;
    pendingActions.clear();

    const actions = [...displayedActions];
    const title =
      displayedCount === 1
        ? "Not supported outside Tauri"
        : `Not supported outside Tauri (${displayedCount})`;
    const maxShown = 3;
    const shown = actions.slice(0, maxShown);
    const extra = actions.length - shown.length;
    const description =
      extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");

    onBatch({
      count: displayedCount,
      actions,
      title,
      description,
      onClose,
    });
  };

  const report = (action: string) => {
    pendingCount += 1;
    pendingActions.add(action);
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, debounceMs);
  };

  return { report, reset };
}

let activeHost: HostAdapter | null = null;

export function setHost(host: HostAdapter): void {
  activeHost = host;
}

export function getHost(): HostAdapter {
  if (!activeHost) {
    throw new Error("HostAdapter not initialized — call setHost() first");
  }
  return activeHost;
}
