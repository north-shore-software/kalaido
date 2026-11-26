import { isTauri } from "@tauri-apps/api/core";
import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";
import { err, ok, type Result } from "neverthrow";
import type {
  FeedbackContext,
  FeedbackDiagnostics,
  HostAdapter,
  PersistentAppSetting,
  SettingsStore,
} from "#index";

export interface CreateTauriHostOptions {
  variant: "desktop" | "mobile";
  appVersion?: string;
  collectDiagnostics?: (
    context: FeedbackContext,
  ) => Promise<Result<FeedbackDiagnostics, Error>>;
  onUnsupportedAction?: (action: string) => void;
}

const STORE_FILE = "kalaido-settings.json";

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

async function wrapResult<T>(p: Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await p);
  } catch (e) {
    return err(toError(e));
  }
}

function createDummyTauriHost(options: CreateTauriHostOptions): HostAdapter {
  const drop = <T>(action: string, value: T): Promise<Result<T, Error>> => {
    options.onUnsupportedAction?.(action);
    return Promise.resolve(ok(value));
  };

  const settings: SettingsStore = {
    get: async () => ok(undefined),
    getAll: async () => ok({}),
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
    reload: () => {
      options.onUnsupportedAction?.("reload");
    },
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
    get: (key) => wrapResult(getStore().then((s) => s.get(key))),
    getAll: () =>
      wrapResult(
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
      wrapResult(
        getStore().then(async (s) => {
          await s.set(key, value);
          await s.save();
        }),
      ),
    delete: (key) =>
      wrapResult(
        getStore().then(async (s) => {
          await s.delete(key);
          await s.save();
        }),
      ),
    clear: () =>
      wrapResult(
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
        wrapResult(writeHtml(html, altText).catch(() => writeText(altText))),
    },
    diagnostics: {
      collect: (context) => {
        if (options.collectDiagnostics) {
          return options.collectDiagnostics(context);
        }
        return Promise.resolve(
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
        );
      },
    },
    openExternalUrl: (url) => wrapResult(openUrl(url)),
    reload: () => {
      window.location.reload();
    },
  };
}
