import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ok, type Result } from "neverthrow";
import type {
  DesktopHostAdapter,
  FeedbackContext,
  FeedbackDiagnostics,
  LlmValidateKeyResult,
  LocalFileEntry,
  OllamaReachability,
  SidecarCreationDetails,
  SidecarStatus,
  UnlistenFn,
  UpdateMetadata,
} from "#index";
import { createTauriHost, wrapTauriResult } from "#tauri";

export interface CreateDesktopTauriHostOptions {
  appVersion?: string;
  onUnsupportedAction?: (action: string) => void;
}

interface HostDiagnosticsPayload {
  appVersion: string;
  os: string;
  arch: string;
  sidecarPhase: string | null;
  sidecarLog: string[];
}

const NOOP_UNLISTEN: UnlistenFn = () => {};

function createDummyDesktopTauriHost(
  options?: CreateDesktopTauriHostOptions,
): DesktopHostAdapter {
  const base = createTauriHost({
    variant: "desktop",
    appVersion: options?.appVersion,
    onUnsupportedAction: options?.onUnsupportedAction,
  });

  const drop = <T>(action: string, value: T): Promise<Result<T, Error>> => {
    options?.onUnsupportedAction?.(action);
    return Promise.resolve(ok(value));
  };

  return {
    ...base,
    dialogs: {
      openFile: () => drop("dialog.open", null),
      openDirectory: () => drop("dialog.open(directory)", null),
      saveFile: () => drop("dialog.save", null),
    },
    menu: {
      onNavigate: () => drop("listen(menu:navigate)", NOOP_UNLISTEN),
      onFeedback: () => drop("listen(menu:feedback)", NOOP_UNLISTEN),
      onCheckUpdates: () => drop("listen(menu:check-updates)", NOOP_UNLISTEN),
    },
    updater: {
      check: () => drop("check_for_update", { status: "unsupported" }),
      install: () => drop("install_pending_update", undefined),
    },
    files: {
      classifyPath: () => drop("classify_path", []),
      readBytes: () => drop("read_file_bytes", new ArrayBuffer(0)),
      downloadToFile: () => drop("download_to_file", undefined),
    },
    sidecar: {
      onStatusChange: () =>
        drop("listen(sidecar:pocketbase:status)", NOOP_UNLISTEN),
      create: (kalaidoscopeId, dataDir) =>
        drop("create_local_kalaidoscope", {
          path: dataDir ?? `/dummy/${kalaidoscopeId}`,
        }),
      start: () => drop("start_local_kalaidoscope", undefined),
      stop: () => drop("stop_local_kalaidoscope", undefined),
      delete: () => drop("delete_local_kalaidoscope", undefined),
      getStatus: (kalaidoscopeId) =>
        drop("get_local_kalaidoscope_status", {
          phase: "failed",
          id: kalaidoscopeId,
          message: "Local sidecar is not available outside Tauri",
          port: null,
        }),
      getAuthToken: () => drop("get_local_kalaidoscope_auth_token", ""),
    },
    llm: {
      checkOllamaStatus: () =>
        drop("check_ollama_status", { reachable: false }),
      validateKey: () => drop("validate_llm_key", { ok: true }),
    },
  };
}

async function collectDesktopDiagnostics(
  context: FeedbackContext,
): Promise<Result<FeedbackDiagnostics, Error>> {
  const result = await wrapTauriResult(
    invoke<HostDiagnosticsPayload>("get_feedback_diagnostics", {
      kalaidoscopeId: context.kalaidoscopeId,
    }),
  );
  return result.map((host) => ({
    appVersion: host.appVersion,
    os: host.os,
    arch: host.arch,
    variant: "desktop",
    route: context.route,
    kalaidoscopeType: context.kalaidoscopeType,
    sidecarPhase: host.sidecarPhase,
    sidecarLog: host.sidecarLog,
  }));
}

export function createDesktopTauriHost(
  options?: CreateDesktopTauriHostOptions,
): DesktopHostAdapter {
  if (!isTauri()) {
    return createDummyDesktopTauriHost(options);
  }

  const base = createTauriHost({
    variant: "desktop",
    appVersion: options?.appVersion,
    onUnsupportedAction: options?.onUnsupportedAction,
  });

  return {
    ...base,
    diagnostics: {
      collect: collectDesktopDiagnostics,
    },
    dialogs: {
      openFile: (filters) =>
        wrapTauriResult(open({ multiple: false, directory: false, filters })),
      openDirectory: () => wrapTauriResult(open({ directory: true })),
      saveFile: (defaultPath, filters) =>
        wrapTauriResult(save({ defaultPath, filters })),
    },
    menu: {
      onNavigate: (cb) =>
        wrapTauriResult(listen<string>("menu:navigate", (e) => cb(e.payload))),
      onFeedback: (cb) => wrapTauriResult(listen("menu:feedback", () => cb())),
      onCheckUpdates: (cb) =>
        wrapTauriResult(listen("menu:check-updates", () => cb())),
    },
    updater: {
      check: async () =>
        (
          await wrapTauriResult(
            invoke<UpdateMetadata | null>("check_for_update"),
          )
        ).map((update) =>
          update
            ? { status: "available" as const, update }
            : { status: "up_to_date" as const },
        ),
      install: () => wrapTauriResult(invoke<void>("install_pending_update")),
    },
    files: {
      classifyPath: (path) =>
        wrapTauriResult(invoke<LocalFileEntry[]>("classify_path", { path })),
      readBytes: (path) =>
        wrapTauriResult(invoke<ArrayBuffer>("read_file_bytes", { path })),
      downloadToFile: (url, headers, destPath) =>
        wrapTauriResult(
          invoke<void>("download_to_file", { url, headers, destPath }),
        ),
    },
    sidecar: {
      onStatusChange: (cb) =>
        wrapTauriResult(
          listen<SidecarStatus>("sidecar:pocketbase:status", (e) =>
            cb(e.payload),
          ),
        ),
      create: (kalaidoscopeId, dataDir) =>
        wrapTauriResult(
          invoke<SidecarCreationDetails>("create_local_kalaidoscope", {
            kalaidoscopeId,
            dataDir,
          }),
        ),
      start: (dataDir) =>
        wrapTauriResult(invoke<void>("start_local_kalaidoscope", { dataDir })),
      stop: (kalaidoscopeId) =>
        wrapTauriResult(
          invoke<void>("stop_local_kalaidoscope", { kalaidoscopeId }),
        ),
      delete: (dataDir) =>
        wrapTauriResult(invoke<void>("delete_local_kalaidoscope", { dataDir })),
      getStatus: (kalaidoscopeId) =>
        wrapTauriResult(
          invoke<SidecarStatus>("get_local_kalaidoscope_status", {
            kalaidoscopeId,
          }),
        ),
      getAuthToken: (kalaidoscopeId) =>
        wrapTauriResult(
          invoke<string>("get_local_kalaidoscope_auth_token", {
            kalaidoscopeId,
          }),
        ),
    },
    llm: {
      checkOllamaStatus: () =>
        wrapTauriResult(invoke<OllamaReachability>("check_ollama_status")),
      validateKey: ({ provider, apiKey, model }) =>
        wrapTauriResult(
          invoke<LlmValidateKeyResult>("validate_llm_key", {
            provider,
            apiKey,
            model,
          }),
        ),
    },
  };
}
