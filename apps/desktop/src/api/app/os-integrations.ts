import { getHost } from "@kalaido/platform";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Result } from "neverthrow";
import { tauriCall } from "@/api/app/_invoke";

export type { UnlistenFn };

const NOOP_UNLISTEN: UnlistenFn = () => {};

export function writeClipboardHtml(
  html: string,
  altText: string,
): Promise<Result<void, Error>> {
  return getHost().clipboard.writeHtml(html, altText);
}

export function openFilePicker(
  filters?: { name: string; extensions: string[] }[],
): Promise<Result<string | null, Error>> {
  return tauriCall(
    "dialog.open",
    () => open({ multiple: false, directory: false, filters }),
    null,
  );
}

export function saveFilePicker(
  defaultPath?: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<Result<string | null, Error>> {
  return tauriCall("dialog.save", () => save({ defaultPath, filters }), null);
}

export function openDirectoryPicker(): Promise<Result<string | null, Error>> {
  return tauriCall(
    "dialog.open(directory)",
    () => open({ directory: true }),
    null,
  );
}

export function openSystemBrowser(url: string): Promise<Result<void, Error>> {
  return getHost().openExternalUrl(url);
}

export function registerMenuNavigateListener(
  cb: (path: string) => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriCall(
    "listen(menu:navigate)",
    () => listen<string>("menu:navigate", (e) => cb(e.payload)),
    NOOP_UNLISTEN,
    { silent: true },
  );
}

export function registerMenuFeedbackListener(
  cb: () => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriCall(
    "listen(menu:feedback)",
    () => listen("menu:feedback", () => cb()),
    NOOP_UNLISTEN,
    { silent: true },
  );
}

export function registerMenuUpdateListener(
  cb: () => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriCall(
    "listen(menu:check-updates)",
    () => listen("menu:check-updates", () => cb()),
    NOOP_UNLISTEN,
    { silent: true },
  );
}

export function reloadAppWindow(): void {
  getHost().reload();
}
