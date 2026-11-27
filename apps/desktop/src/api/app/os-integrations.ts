import {
  type FileDialogFilter,
  getHost,
  type UnlistenFn,
} from "@kalaido/platform";
import type { Result } from "neverthrow";
import { getDesktopHost } from "@/host";

export type { UnlistenFn };

export function writeClipboardHtml(
  html: string,
  altText: string,
): Promise<Result<void, Error>> {
  return getHost().clipboard.writeHtml(html, altText);
}

export function openFilePicker(
  filters?: FileDialogFilter[],
): Promise<Result<string | null, Error>> {
  return getDesktopHost().dialogs.openFile(filters);
}

export function saveFilePicker(
  defaultPath?: string,
  filters?: FileDialogFilter[],
): Promise<Result<string | null, Error>> {
  return getDesktopHost().dialogs.saveFile(defaultPath, filters);
}

export function openDirectoryPicker(): Promise<Result<string | null, Error>> {
  return getDesktopHost().dialogs.openDirectory();
}

export function openSystemBrowser(url: string): Promise<Result<void, Error>> {
  return getHost().openExternalUrl(url);
}

export function registerMenuNavigateListener(
  cb: (path: string) => void,
): Promise<Result<UnlistenFn, Error>> {
  return getDesktopHost().menu.onNavigate(cb);
}

export function registerMenuFeedbackListener(
  cb: () => void,
): Promise<Result<UnlistenFn, Error>> {
  return getDesktopHost().menu.onFeedback(cb);
}

export function registerMenuUpdateListener(
  cb: () => void,
): Promise<Result<UnlistenFn, Error>> {
  return getDesktopHost().menu.onCheckUpdates(cb);
}

export function reloadAppWindow(): void {
  getHost().reload();
}
