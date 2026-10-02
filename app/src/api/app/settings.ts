import { isTauri } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";
import type { AppState } from "@/hooks/use-app-state.ts";

export type PersistentAppSetting = Pick<
  AppState,
  "lightDarkMode" | "availableKalaidoscopes"
> & {
  lastOpenedKalaidoscopeId: string;
  ollamaModel: string;
  /** Pinned projection ids, keyed by kalaidoscope id. */
  pinnedProjections: Record<string, string[]>;
};

type SettingsBackend = {
  get<K extends keyof PersistentAppSetting>(
    key: K,
  ): Promise<PersistentAppSetting[K] | undefined>;
  entries(): Promise<Partial<PersistentAppSetting>>;
  set<K extends keyof PersistentAppSetting>(
    key: K,
    value: PersistentAppSetting[K],
  ): Promise<void>;
  delete(key: keyof PersistentAppSetting): Promise<void>;
  clear(): Promise<void>;
};

const STORE_FILE = "kalaido-settings.json";
const WEB_STORAGE_KEY = "kalaido-settings";

function readWebSettings(): Partial<PersistentAppSetting> {
  try {
    const raw = window.localStorage.getItem(WEB_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistentAppSetting>) : {};
  } catch {
    return {};
  }
}

function writeWebSettings(data: Partial<PersistentAppSetting>): void {
  window.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(data));
}

let storePromise: Promise<Store> | null = null;
const getStore = (): Promise<Store> => (storePromise ??= load(STORE_FILE));

const storeBackend: SettingsBackend = {
  get: (key) => getStore().then((s) => s.get(key)),
  entries: () =>
    getStore()
      .then((s) =>
        s.entries<PersistentAppSetting[keyof PersistentAppSetting]>(),
      )
      .then(
        (entries) =>
          Object.fromEntries(entries) as Partial<PersistentAppSetting>,
      ),
  set: async (key, value) => {
    const s = await getStore();
    await s.set(key, value);
    await s.save();
  },
  delete: async (key) => {
    const s = await getStore();
    await s.delete(key);
    await s.save();
  },
  clear: async () => {
    const s = await getStore();
    await s.clear();
    await s.save();
  },
};

const webBackend: SettingsBackend = {
  get: async (key) => readWebSettings()[key],
  entries: async () => readWebSettings(),
  set: async (key, value) => {
    const settings = readWebSettings();
    settings[key] = value;
    writeWebSettings(settings);
  },
  delete: async (key) => {
    const settings = readWebSettings();
    delete settings[key];
    writeWebSettings(settings);
  },
  clear: async () => {
    window.localStorage.removeItem(WEB_STORAGE_KEY);
  },
};

const backend = (): SettingsBackend => (isTauri() ? storeBackend : webBackend);

export function getSetting<K extends keyof PersistentAppSetting>(
  key: K,
): Promise<Result<PersistentAppSetting[K] | undefined, Error>> {
  return tauriResult(backend().get(key));
}

export function getAllSettings(): Promise<
  Result<Partial<PersistentAppSetting>, Error>
> {
  return tauriResult(backend().entries());
}

export function setSetting<K extends keyof PersistentAppSetting>(
  key: K,
  value: PersistentAppSetting[K],
): Promise<Result<void, Error>> {
  return tauriResult(backend().set(key, value));
}

export function deleteSetting(
  key: keyof PersistentAppSetting,
): Promise<Result<void, Error>> {
  return tauriResult(backend().delete(key));
}

export function resetAppSettings(): Promise<Result<void, Error>> {
  return tauriResult(backend().clear());
}
