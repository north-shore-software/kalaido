import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export type SidecarPhase =
  | "idle"
  | "spawning"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface SidecarStatus {
  phase: SidecarPhase;
  id: string | null;
  message: string | null;
  port?: number | null;
}

export function registerSidecarStatusChangeListener(
  cb: (status: SidecarStatus) => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriResult(
    listen<SidecarStatus>("sidecar:pocketbase:status", (e) => cb(e.payload)),
  );
}

export interface KalaidoscopeCreationDetails {
  path: string;
}

export function createLocalKalaidoscope(
  kalaidoscopeId: string,
  dataDir?: string,
): Promise<Result<KalaidoscopeCreationDetails, Error>> {
  return tauriResult(
    invoke<KalaidoscopeCreationDetails>("create_local_kalaidoscope", {
      kalaidoscopeId,
      dataDir,
    }),
  );
}

export function startLocalKalaidoscope(
  dataDir: string,
): Promise<Result<void, Error>> {
  return tauriResult(invoke<void>("start_local_kalaidoscope", { dataDir }));
}

export function deleteLocalKalaidoscope(
  dataDir: string,
): Promise<Result<void, Error>> {
  return tauriResult(invoke<void>("delete_local_kalaidoscope", { dataDir }));
}

export function stopLocalKalaidoscope(
  kalaidoscopeId: string,
): Promise<Result<void, Error>> {
  return tauriResult(
    invoke<void>("stop_local_kalaidoscope", { kalaidoscopeId }),
  );
}

export function getLocalKalaidoscopeStatus(
  kalaidoscopeId: string,
): Promise<Result<SidecarStatus, Error>> {
  return tauriResult(
    invoke<SidecarStatus>("get_local_kalaidoscope_status", { kalaidoscopeId }),
  );
}

export function getLocalKalaidoscopeAuthToken(
  kalaidoscopeId: string,
): Promise<Result<string, Error>> {
  return tauriResult(
    invoke<string>("get_local_kalaidoscope_auth_token", { kalaidoscopeId }),
  );
}
