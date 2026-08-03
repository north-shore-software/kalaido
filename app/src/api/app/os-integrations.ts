import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export type { UnlistenFn };

export function openFilePicker(
  filters?: { name: string; extensions: string[] }[],
): Promise<Result<string | null, Error>> {
  return tauriResult(open({ multiple: false, directory: false, filters }));
}

export function openDirectoryPicker(): Promise<Result<string | null, Error>> {
  return tauriResult(open({ directory: true }));
}

export function openSystemBrowser(url: string): Promise<Result<void, Error>> {
  return tauriResult(openUrl(url));
}

export function registerMenuNavigateListener(
  cb: (path: string) => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriResult(listen<string>("menu:navigate", (e) => cb(e.payload)));
}

export function reloadAppWindow(): void {
  window.location.reload();
}
