import type {
  SidecarCreationDetails,
  SidecarPhase,
  SidecarStatus,
  UnlistenFn,
} from "@kalaido/platform";
import type { Result } from "neverthrow";
import { getDesktopHost } from "@/host";

export type { SidecarPhase, SidecarStatus, UnlistenFn };
export type KalaidoscopeCreationDetails = SidecarCreationDetails;

export function registerSidecarStatusChangeListener(
  cb: (status: SidecarStatus) => void,
): Promise<Result<UnlistenFn, Error>> {
  return getDesktopHost().sidecar.onStatusChange(cb);
}

export function createLocalKalaidoscope(
  kalaidoscopeId: string,
  dataDir?: string,
): Promise<Result<KalaidoscopeCreationDetails, Error>> {
  return getDesktopHost().sidecar.create(kalaidoscopeId, dataDir);
}

export function startLocalKalaidoscope(
  dataDir: string,
): Promise<Result<void, Error>> {
  return getDesktopHost().sidecar.start(dataDir);
}

export function deleteLocalKalaidoscope(
  dataDir: string,
): Promise<Result<void, Error>> {
  return getDesktopHost().sidecar.delete(dataDir);
}

export function stopLocalKalaidoscope(
  kalaidoscopeId: string,
): Promise<Result<void, Error>> {
  return getDesktopHost().sidecar.stop(kalaidoscopeId);
}

export function getLocalKalaidoscopeStatus(
  kalaidoscopeId: string,
): Promise<Result<SidecarStatus, Error>> {
  return getDesktopHost().sidecar.getStatus(kalaidoscopeId);
}

export function getLocalKalaidoscopeAuthToken(
  kalaidoscopeId: string,
): Promise<Result<string, Error>> {
  return getDesktopHost().sidecar.getAuthToken(kalaidoscopeId);
}
