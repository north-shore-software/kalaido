import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export interface OllamaStatus {
  reachable: boolean;
}

/**
 * Is Ollama serving on this machine?
 *
 * Goes through Rust rather than the workspace's `/api/ollama/status` route
 * because this runs during workspace setup, before any sidecar exists — see
 * `src-tauri/src/llm.rs`. For a workspace that is already open, use
 * `getLocalAiStatus` in `api/kalaidoscope/local/models.ts` instead: it reports
 * installed models too.
 *
 * Unreachable is an answer, not a failure — an `err` here means the IPC call
 * itself broke.
 */
export function checkOllamaStatus(): Promise<Result<OllamaStatus, Error>> {
  return tauriResult(invoke<OllamaStatus>("check_ollama_status"));
}
