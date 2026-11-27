import type { UpdateCheckResult, UpdateMetadata } from "@kalaido/platform";
import type { Result } from "neverthrow";
import { getDesktopHost } from "@/host";

export type { UpdateCheckResult, UpdateMetadata };

export function checkForUpdate(): Promise<Result<UpdateCheckResult, Error>> {
  return getDesktopHost().updater.check();
}

export function installPendingUpdate(): Promise<Result<void, Error>> {
  return getDesktopHost().updater.install();
}
