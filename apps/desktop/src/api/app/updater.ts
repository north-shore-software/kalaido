import { invoke, isTauri } from "@tauri-apps/api/core";
import { err, ok, type Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
}

export async function checkForUpdate(): Promise<
  Result<UpdateMetadata | null, Error>
> {
  if (!isTauri()) {
    return ok(null);
  }
  return tauriResult(invoke<UpdateMetadata | null>("check_for_update"));
}

export async function installPendingUpdate(): Promise<Result<void, Error>> {
  if (!isTauri()) {
    return err(new Error("Updates are only supported on desktop"));
  }
  return tauriResult(invoke<void>("install_pending_update"));
}
