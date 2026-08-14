import { err, ok, type Result } from "neverthrow";
import { toError } from "@/lib/errors";
import { readNdjson } from "@/lib/ndjson";

const LOCAL_AI_BASE = "http://127.0.0.1:8090/api/ollama";

export interface OllamaModelInfo {
  name: string;
  size: number;
}

export interface LocalAiStatus {
  reachable: boolean;
  models: OllamaModelInfo[];
  error?: string;
}

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
  error?: string;
  done?: boolean;
}

export async function getLocalAiStatus(): Promise<
  Result<LocalAiStatus, Error>
> {
  try {
    const res = await fetch(`${LOCAL_AI_BASE}/status`);
    if (!res.ok) return err(new Error(`Local AI status failed: ${res.status}`));
    return ok((await res.json()) as LocalAiStatus);
  } catch (e) {
    return err(toError(e));
  }
}

/**
 * Pulls a model into Ollama, invoking onProgress for each NDJSON progress line
 * streamed by the backend. Resolves ok when the pull completes; err on failure.
 * An abort via `signal` surfaces as an err wrapping the AbortError.
 */
export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<Result<void, Error>> {
  try {
    const res = await fetch(`${LOCAL_AI_BASE}/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    if (!res.ok || !res.body) {
      return err(new Error(`Model download failed: ${res.status}`));
    }

    for await (const p of readNdjson<PullProgress>(res.body)) {
      if (p.error) return err(new Error(p.error));
      onProgress(p);
    }
    return ok(undefined);
  } catch (e) {
    return err(toError(e));
  }
}

/** True when an installed model name matches a base model (e.g. "gemma3" ↔ "gemma3:latest"). pure, no network */
export function modelMatches(installedName: string, base: string): boolean {
  return installedName === base || installedName.startsWith(`${base}:`);
}
