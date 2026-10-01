import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export function downloadToFile(
  url: string,
  headers: Record<string, string>,
  destPath: string,
): Promise<Result<void, Error>> {
  return tauriResult(
    invoke<void>("download_to_file", { url, headers, destPath }),
  );
}
