import {
  getHost,
  type PersistentAppSetting,
  type SettingsStore,
} from "@kalaido/platform";
import type { ScopePersistenceAdapter } from "@kalaido/state/scope";
import { err, ok } from "neverthrow";

const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.getOwnPropertyDescriptor(obj, key) !== undefined;

/**
 * Kalaido persistence adapter binding `HostAdapter.settings`
 * (`kalaido-settings.json` on Tauri; `localStorage["kalaido-settings"]` on Web)
 * to `@kalaido/state`'s `ScopePersistenceAdapter`.
 */
export function hostSettingsPersistence<
  const K extends readonly (keyof PersistentAppSetting & string)[],
>(
  keys: K,
  settings?: SettingsStore,
): ScopePersistenceAdapter<Pick<PersistentAppSetting, K[number]>> {
  const allowed = new Set<string>(keys);
  const store = () => settings ?? getHost().settings;

  return {
    load: async () => {
      const res = await store().getAll();
      if (res.isErr()) return err(res.error);
      const picked: Partial<Pick<PersistentAppSetting, K[number]>> = {};
      for (const key of keys) {
        if (hasOwn(res.value, key) && res.value[key] !== undefined) {
          (picked as Record<string, unknown>)[key] = res.value[key];
        }
      }
      return ok(picked);
    },
    save: (key, value) => {
      if (!allowed.has(key)) return Promise.resolve(ok(undefined));
      return store().set(key, value as PersistentAppSetting[typeof key]);
    },
    remove: (key) => {
      if (!allowed.has(key)) return Promise.resolve(ok(undefined));
      return store().delete(key);
    },
  };
}
