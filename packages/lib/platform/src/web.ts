import { err, ok, type Result } from "neverthrow";
import type { HostAdapter, PersistentAppSetting, SettingsStore } from "#index";

export interface CreateWebHostOptions {
  appVersion?: string;
}

const WEB_STORAGE_KEY = "kalaido-settings";

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

export function createWebHost(options?: CreateWebHostOptions): HostAdapter {
  const settings: SettingsStore = {
    get: async (key) => ok(readWebSettings()[key]),
    getAll: async () => ok(readWebSettings()),
    set: (key, value) =>
      wrapResult(
        Promise.resolve().then(() => {
          const current = readWebSettings();
          current[key] = value;
          writeWebSettings(current);
        }),
      ),
    delete: (key) =>
      wrapResult(
        Promise.resolve().then(() => {
          const current = readWebSettings();
          delete current[key];
          writeWebSettings(current);
        }),
      ),
    clear: () =>
      wrapResult(
        Promise.resolve().then(() => {
          window.localStorage.removeItem(WEB_STORAGE_KEY);
        }),
      ),
  };

  return {
    variant: "web",
    settings,
    clipboard: {
      writeHtml: (html, altText) => {
        if (
          typeof ClipboardItem !== "undefined" &&
          navigator.clipboard?.write
        ) {
          return wrapResult(
            navigator.clipboard.write([
              new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([altText], { type: "text/plain" }),
              }),
            ]),
          );
        }
        return wrapResult(navigator.clipboard.writeText(altText));
      },
    },
    diagnostics: {
      collect: (context) =>
        Promise.resolve(
          ok({
            appVersion: options?.appVersion ?? "web",
            os: typeof navigator !== "undefined" ? navigator.platform : "web",
            arch: "web",
            variant: "web",
            route: context.route,
            kalaidoscopeType: context.kalaidoscopeType,
            sidecarPhase: null,
            sidecarLog: [],
          }),
        ),
    },
    openExternalUrl: (url) => {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
        return Promise.resolve(ok(undefined));
      } catch (e) {
        return Promise.resolve(err(toError(e)));
      }
    },
    reload: () => {
      window.location.reload();
    },
  };
}
