import { activeClient } from "./_active";
import type { ContextSpec, TimeWindow } from "./chat";
import { kalaidoscopeAuthHeaders } from "./client";

export interface TokenResolutionResponse {
  totalTokens: number;
  breakdown: Record<string, number>;
  /** The chat model the estimate was checked against. */
  model: string;
  /** That model's prompt budget in tokens; 0 when the provider reports no window. */
  limit: number;
  /** Whether `totalTokens` is within `limit` (always true when unknown). */
  fits: boolean;
}

/**
 * Estimate what a spec would put in front of the model, optionally within a
 * reflection's target window. The chat's 422 guard stays authoritative.
 */
export async function resolveContextTokens(
  spec: ContextSpec,
  window?: TimeWindow,
): Promise<TokenResolutionResponse> {
  const client = activeClient();
  if (client.isErr()) throw client.error;
  const baseURL = client.value.baseURL;

  const body = window
    ? { ...spec, window: { start: window.start, end: window.end } }
    : spec;
  const res = await fetch(`${baseURL}/api/context/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await kalaidoscopeAuthHeaders(baseURL)),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve tokens: ${res.statusText}`);
  }

  return res.json();
}
