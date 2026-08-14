import { load, type Store } from "@tauri-apps/plugin-store";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";
import type { KalaidoscopeAction } from "@/features/create-kalaidoscope";
import type { AppState } from "@/hooks/use-app-state.ts";

export type PersistentAppSetting = Pick<
  AppState,
  "lightDarkMode" | "availableKalaidoscopes"
> & {
  lastOpenedKalaidoscopeId: string;
  ollamaModel: string;
  /** Pinned projection ids, keyed by kalaidoscope id. */
  pinnedProjections: Record<string, string[]>;
  /** Home-page action cards, keyed by kalaidoscope id. */
  kalaidoscopeActions: Record<string, KalaidoscopeAction[]>;
};

const STORE_FILE = "kalaido-settings.json";

let storePromise: Promise<Store> | null = null;
const getStore = (): Promise<Store> => (storePromise ??= load(STORE_FILE));

export function getSetting<K extends keyof PersistentAppSetting>(
  key: K,
): Promise<Result<PersistentAppSetting[K] | undefined, Error>> {
  return tauriResult(
    getStore().then((s) => s.get<PersistentAppSetting[K]>(key)),
  );
}

export function getAllSettings(): Promise<
  Result<Partial<PersistentAppSetting>, Error>
> {
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
  return tauriResult(
    getStore().then(async (s) => {
      await s.delete(key);
      await s.save();
    }),
  );
}

export function resetAppSettings(): Promise<Result<void, Error>> {
  return tauriResult(
    getStore().then(async (s) => {
      await s.clear();
      await s.save();
    }),
  );
}
