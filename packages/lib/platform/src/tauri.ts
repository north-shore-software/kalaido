import { isTauri } from "@tauri-apps/api/core";
import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";
import { err, ok, type Result } from "neverthrow";
import type { HostAdapter, PersistentAppSetting, SettingsStore } from "#index";

export interface CreateTauriHostOptions {
  variant: "desktop" | "mobile";
  appVersion?: string;
  onUnsupportedAction?: (action: string) => void;
}

const STORE_FILE = "kalaido-settings.json";

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export async function wrapTauriResult<T>(
  p: Promise<T>,
): Promise<Result<T, Error>> {
  try {
    return ok(await p);
  } catch (e) {
    return err(toError(e));
  }
}

function reloadWindow(): void {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

function createDummyTauriHost(options: CreateTauriHostOptions): HostAdapter {
  const drop = <T>(action: string, value: T): Promise<Result<T, Error>> => {
    options.onUnsupportedAction?.(action);
    return Promise.resolve(ok(value));
  };

  const settings: SettingsStore = {
    get: (key) => drop(`settings.get(${key})`, undefined),
    getAll: () => drop("settings.getAll", {}),
    set: (key) => drop(`settings.set(${key})`, undefined),
    delete: (key) => drop(`settings.delete(${key})`, undefined),
    clear: () => drop("settings.clear", undefined),
  };

  return {
    variant: options.variant,
    settings,
    clipboard: {
      writeHtml: () => drop("clipboard.writeHtml", undefined),
    },
    diagnostics: {
      collect: (context) =>
        drop("diagnostics.collect", {
          appVersion: options.appVersion ?? "dev",
          os: typeof navigator !== "undefined" ? navigator.platform : "unknown",
          arch: "unknown",
          variant: options.variant,
          route: context.route,
          kalaidoscopeType: context.kalaidoscopeType,
          sidecarPhase: null,
          sidecarLog: [],
        }),
    },
    openExternalUrl: () => drop("openExternalUrl", undefined),
    reload: reloadWindow,
  };
}

export function createTauriHost(options: CreateTauriHostOptions): HostAdapter {
  if (!isTauri()) {
    return createDummyTauriHost(options);
  }
  let storePromise: Promise<Store> | null = null;
  const getStore = (): Promise<Store> =>
    (storePromise ??= load(STORE_FILE).catch((e) => {
      storePromise = null;
      throw e;
    }));

  const settings: SettingsStore = {
    get: (key) => wrapTauriResult(getStore().then((s) => s.get(key))),
    getAll: () =>
      wrapTauriResult(
        getStore()
          .then((s) =>
            s.entries<PersistentAppSetting[keyof PersistentAppSetting]>(),
          )
          .then(
            (entries) =>
              Object.fromEntries(entries) as Partial<PersistentAppSetting>,
          ),
      ),
    set: (key, value) =>
      wrapTauriResult(
        getStore().then(async (s) => {
          await s.set(key, value);
          await s.save();
        }),
      ),
    delete: (key) =>
      wrapTauriResult(
        getStore().then(async (s) => {
          await s.delete(key);
          await s.save();
        }),
      ),
    clear: () =>
      wrapTauriResult(
        getStore().then(async (s) => {
          await s.clear();
          await s.save();
        }),
      ),
  };

  return {
    variant: options.variant,
    settings,
    clipboard: {
      writeHtml: (html, altText) =>
        wrapTauriResult(
          writeHtml(html, altText).catch(() => writeText(altText)),
        ),
    },
    diagnostics: {
      collect: (context) =>
        Promise.resolve(
          ok({
            appVersion: options.appVersion ?? "unknown",
            os:
              typeof navigator !== "undefined" ? navigator.platform : "unknown",
            arch: "unknown",
            variant: options.variant,
            route: context.route,
            kalaidoscopeType: context.kalaidoscopeType,
            sidecarPhase: null,
            sidecarLog: [],
          }),
        ),
    },
    openExternalUrl: (url) => wrapTauriResult(openUrl(url)),
    reload: reloadWindow,
  };
}
