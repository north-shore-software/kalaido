import {
  type CloudStage,
  createCloudRootScope,
  openCloudWorkspaceForScope,
  prepareCloudScopeReset,
  signOutOfCloudForScope,
  syncCloudWorkspacesForScope,
  wireCloudScopeTokenBridge,
} from "@kalaido/hooks/cloud-root-scope";
import type { Result } from "neverthrow";

export type { CloudStage };

export const cloudScope = createCloudRootScope();

let detachTokenBridge: (() => void) | null = null;

export async function bootstrapCloudState(): Promise<void> {
  detachTokenBridge ??= wireCloudScopeTokenBridge(cloudScope);
  await cloudScope.hydrate();
}

export function syncCloudWorkspaces(): Promise<Result<void, Error>> {
  return syncCloudWorkspacesForScope(cloudScope);
}

export function openCloudWorkspace(
  targetId: string,
  opts?: { surfaceError?: boolean },
): Promise<Result<void, Error>> {
  return openCloudWorkspaceForScope(cloudScope, targetId, opts);
}

export function signOutOfCloud(): Promise<void> {
  return signOutOfCloudForScope(cloudScope, () => {
    detachTokenBridge?.();
    detachTokenBridge = null;
  });
}

export function prepareCloudReset(): Promise<void> {
  return prepareCloudScopeReset(cloudScope, () => {
    detachTokenBridge?.();
    detachTokenBridge = null;
  });
}
