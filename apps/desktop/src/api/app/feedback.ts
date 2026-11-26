import type { FeedbackContext, FeedbackDiagnostics } from "@kalaido/platform";
import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriCall } from "@/api/app/_invoke";

interface HostDiagnostics {
  appVersion: string;
  os: string;
  arch: string;
  sidecarPhase: string | null;
  sidecarLog: string[];
}

export async function getFeedbackDiagnostics(
  context: FeedbackContext,
): Promise<Result<FeedbackDiagnostics, Error>> {
  const result = await tauriCall(
    "get_feedback_diagnostics",
    () =>
      invoke<HostDiagnostics>("get_feedback_diagnostics", {
        kalaidoscopeId: context.kalaidoscopeId,
      }),
    {
      appVersion: "dev",
      os: typeof navigator !== "undefined" ? navigator.platform : "unknown",
      arch: "unknown",
      sidecarPhase: null,
      sidecarLog: [],
    },
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
