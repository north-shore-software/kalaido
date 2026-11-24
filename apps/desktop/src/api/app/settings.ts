import { getHost, type PersistentAppSetting } from "@kalaido/platform";
import type { Result } from "neverthrow";

export type { PersistentAppSetting };

export function getSetting<K extends keyof PersistentAppSetting>(
  key: K,
): Promise<Result<PersistentAppSetting[K] | undefined, Error>> {
  return getHost().settings.get(key);
}

export function getAllSettings(): Promise<
  Result<Partial<PersistentAppSetting>, Error>
> {
  return getHost().settings.getAll();
}

export function setSetting<K extends keyof PersistentAppSetting>(
  key: K,
  value: PersistentAppSetting[K],
): Promise<Result<void, Error>> {
  return getHost().settings.set(key, value);
}

export function deleteSetting(
  key: keyof PersistentAppSetting,
): Promise<Result<void, Error>> {
  return getHost().settings.delete(key);
}

export function resetAppSettings(): Promise<Result<void, Error>> {
  return getHost().settings.clear();
}
