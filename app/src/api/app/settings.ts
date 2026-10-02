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

export function getSetting<K extends keyof PersistentAppSetting>(
  key: K,
): Promise<Result<PersistentAppSetting[K] | undefined, Error>> {
  if (!isTauri()) {
    return tauriResult(Promise.resolve().then(() => readWebSettings()[key]));
  }
  return tauriResult(
    getStore().then((s) => s.get<PersistentAppSetting[K]>(key)),
  );
}

export function getAllSettings(): Promise<
  Result<Partial<PersistentAppSetting>, Error>
> {
  if (!isTauri()) {
    return tauriResult(Promise.resolve().then(() => readWebSettings()));
  }
  return tauriResult(
    getStore()
      .then((s) =>
        s.entries<PersistentAppSetting[keyof PersistentAppSetting]>(),
      )
      .then(
        (entries) =>
          Object.fromEntries(entries) as Partial<PersistentAppSetting>,
      ),
  );
}

export function setSetting<K extends keyof PersistentAppSetting>(
  key: K,
  value: PersistentAppSetting[K],
): Promise<Result<void, Error>> {
  if (!isTauri()) {
    return tauriResult(
      Promise.resolve().then(() => {
        const settings = readWebSettings();
        settings[key] = value;
        writeWebSettings(settings);
      }),
    );
  }
  return tauriResult(
    getStore().then(async (s) => {
      await s.set(key, value);
      await s.save();
    }),
  );
}

export function deleteSetting(
  key: keyof PersistentAppSetting,
): Promise<Result<void, Error>> {
  if (!isTauri()) {
    return tauriResult(
      Promise.resolve().then(() => {
        const settings = readWebSettings();
        delete settings[key];
        writeWebSettings(settings);
      }),
    );
  }
  return tauriResult(
    getStore().then(async (s) => {
      await s.delete(key);
      await s.save();
    }),
  );
}

export function resetAppSettings(): Promise<Result<void, Error>> {
  if (!isTauri()) {
    return tauriResult(
      Promise.resolve().then(() => {
        window.localStorage.removeItem(WEB_STORAGE_KEY);
      }),
    );
  }
  return tauriResult(
    getStore().then(async (s) => {
      await s.clear();
      await s.save();
    }),
  );
}
