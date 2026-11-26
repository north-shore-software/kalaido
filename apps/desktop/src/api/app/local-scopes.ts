import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Result } from "neverthrow";
import { tauriCall } from "@/api/app/_invoke.ts";

export type { UnlistenFn };

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

const NOOP_UNLISTEN: UnlistenFn = () => {};

export function registerSidecarStatusChangeListener(
  cb: (status: SidecarStatus) => void,
): Promise<Result<UnlistenFn, Error>> {
  return tauriCall(
    "listen(sidecar:pocketbase:status)",
    () =>
      listen<SidecarStatus>("sidecar:pocketbase:status", (e) => cb(e.payload)),
    NOOP_UNLISTEN,
    { silent: true },
  );
}

export interface KalaidoscopeCreationDetails {
  path: string;
}

export function createLocalKalaidoscope(
  kalaidoscopeId: string,
  dataDir?: string,
): Promise<Result<KalaidoscopeCreationDetails, Error>> {
  return tauriCall(
    "create_local_kalaidoscope",
    () =>
      invoke<KalaidoscopeCreationDetails>("create_local_kalaidoscope", {
        kalaidoscopeId,
        dataDir,
      }),
    { path: dataDir ?? `/dummy/${kalaidoscopeId}` },
  );
}

export function startLocalKalaidoscope(
  dataDir: string,
): Promise<Result<void, Error>> {
  return tauriCall(
    "start_local_kalaidoscope",
    () => invoke<void>("start_local_kalaidoscope", { dataDir }),
    undefined,
  );
}

export function deleteLocalKalaidoscope(
  dataDir: string,
): Promise<Result<void, Error>> {
  return tauriCall(
    "delete_local_kalaidoscope",
    () => invoke<void>("delete_local_kalaidoscope", { dataDir }),
    undefined,
  );
}

export function stopLocalKalaidoscope(
  kalaidoscopeId: string,
): Promise<Result<void, Error>> {
  return tauriCall(
    "stop_local_kalaidoscope",
    () => invoke<void>("stop_local_kalaidoscope", { kalaidoscopeId }),
    undefined,
  );
}

export function getLocalKalaidoscopeStatus(
  kalaidoscopeId: string,
): Promise<Result<SidecarStatus, Error>> {
  return tauriCall(
    "get_local_kalaidoscope_status",
    () =>
      invoke<SidecarStatus>("get_local_kalaidoscope_status", {
        kalaidoscopeId,
      }),
    {
      phase: "failed",
      id: kalaidoscopeId,
      message: "Local sidecar is not available outside Tauri",
      port: null,
    },
  );
}

export function getLocalKalaidoscopeAuthToken(
  kalaidoscopeId: string,
): Promise<Result<string, Error>> {
  return tauriCall(
    "get_local_kalaidoscope_auth_token",
    () =>
      invoke<string>("get_local_kalaidoscope_auth_token", { kalaidoscopeId }),
    "",
  );
}
