import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriCall } from "@/api/app/_invoke.ts";

export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
}

export function checkForUpdate(): Promise<
  Result<UpdateMetadata | null, Error>
> {
  return tauriCall(
    "check_for_update",
    () => invoke<UpdateMetadata | null>("check_for_update"),
    null,
  );
}

export function installPendingUpdate(): Promise<Result<void, Error>> {
  return tauriCall(
    "install_pending_update",
    () => invoke<void>("install_pending_update"),
    undefined,
  );
}
