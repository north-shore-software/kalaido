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

export interface HostAdapter {
  readonly variant: AppVariant;
  readonly settings: SettingsStore;
  readonly clipboard: ClipboardAdapter;
  readonly diagnostics: DiagnosticsAdapter;
  openExternalUrl(url: string): Promise<Result<void, Error>>;
  reload(): void;
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
