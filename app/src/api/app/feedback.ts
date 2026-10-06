import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { type AppVariant, appVariant } from "@/lib/app-variant";

interface HostDiagnostics {
  appVersion: string;
  os: string;
  arch: string;
  sidecarPhase: string | null;
  sidecarLog: string[];
}

export interface FeedbackContext {
  kalaidoscopeId: string | null;
  kalaidoscopeType: KalaidoscopeMeta["type"] | null;
  route: string;
}

export interface FeedbackDiagnostics extends HostDiagnostics {
  variant: AppVariant;
  route: string;
  kalaidoscopeType: KalaidoscopeMeta["type"] | null;
}

export async function getFeedbackDiagnostics(
  context: FeedbackContext,
): Promise<Result<FeedbackDiagnostics, Error>> {
  const result = await tauriResult(
    invoke<HostDiagnostics>("get_feedback_diagnostics", {
      kalaidoscopeId: context.kalaidoscopeId,
    }),
  );
  return result.map((host) => ({
    appVersion: host.appVersion,
    os: host.os,
    arch: host.arch,
    variant: appVariant(),
    route: context.route,
    kalaidoscopeType: context.kalaidoscopeType,
    sidecarPhase: host.sidecarPhase,
    sidecarLog: host.sidecarLog,
  }));
}
