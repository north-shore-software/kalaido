import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriCall } from "@/api/app/_invoke.ts";

export function downloadToFile(
  url: string,
  headers: Record<string, string>,
  destPath: string,
): Promise<Result<void, Error>> {
  return tauriCall(
    "download_to_file",
    () => invoke<void>("download_to_file", { url, headers, destPath }),
    undefined,
  );
}
