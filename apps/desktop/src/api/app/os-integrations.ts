import { getHost } from "@kalaido/platform";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke";

export type { UnlistenFn };

export function writeClipboardHtml(
  html: string,
  altText: string,
): Promise<Result<void, Error>> {
  return getHost().clipboard.writeHtml(html, altText);
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
  return getHost().openExternalUrl(url);
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
  getHost().reload();
}
