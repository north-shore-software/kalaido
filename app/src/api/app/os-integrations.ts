import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ok, type Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export type { UnlistenFn };

export function writeClipboardHtml(
  html: string,
  altText: string,
): Promise<Result<void, Error>> {
  if (!isTauri()) {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      return tauriResult(
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([altText], { type: "text/plain" }),
          }),
        ]),
      );
    }
    return tauriResult(navigator.clipboard.writeText(altText));
  }
  return tauriResult(writeHtml(html, altText).catch(() => writeText(altText)));
}

export function openFilePicker(
  filters?: { name: string; extensions: string[] }[],
): Promise<Result<string | null, Error>> {
  return tauriResult(open({ multiple: false, directory: false, filters }));
}

export function saveFilePicker(
  defaultPath?: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<Result<string | null, Error>> {
  return tauriResult(save({ defaultPath, filters }));
}

export function openDirectoryPicker(): Promise<Result<string | null, Error>> {
  return tauriResult(open({ directory: true }));
}

export function openSystemBrowser(url: string): Promise<Result<void, Error>> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve(ok(undefined));
  }
  return tauriResult(openUrl(url));
}

export function registerMenuNavigateListener(
  cb: (path: string) => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriResult(listen<string>("menu:navigate", (e) => cb(e.payload)));
}

export function registerMenuFeedbackListener(
  cb: () => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriResult(listen("menu:feedback", () => cb()));
}

export function registerMenuUpdateListener(
  cb: () => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriResult(listen("menu:check-updates", () => cb()));
}

export function reloadAppWindow(): void {
  window.location.reload();
}
