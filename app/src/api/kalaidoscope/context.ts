import { activeClient } from "./_active";
import type { ContextSpec } from "./chat";
import { kalaidoscopeAuthHeaders } from "./client";

export interface TokenResolutionResponse {
  totalTokens: number;
  breakdown: Record<string, number>;
}

export async function resolveContextTokens(
  spec: ContextSpec,
): Promise<TokenResolutionResponse> {
  const client = activeClient();
  if (client.isErr()) throw client.error;
  const baseURL = client.value.baseURL;

  const res = await fetch(`${baseURL}/api/context/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await kalaidoscopeAuthHeaders(baseURL)),
    },
    body: JSON.stringify(spec),
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve tokens: ${res.statusText}`);
  }

  return res.json();
}
