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
} from "#index.ts";

export interface CreateTauriHostOptions {
  variant: "desktop" | "mobile";
  appVersion?: string;
  collectDiagnostics?: (
    context: FeedbackContext,
  ) => Promise<Result<FeedbackDiagnostics, Error>>;
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

export function createTauriHost(options: CreateTauriHostOptions): HostAdapter {
  let storePromise: Promise<Store> | null = null;
  const getStore = (): Promise<Store> => (storePromise ??= load(STORE_FILE));

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
