import type { Result } from "neverthrow";
import { withActiveClient } from "../_active";

export const QUOTA_MESSAGE =
  "You have reached your AI usage allowance. Upgrade your plan or try again later.";

/**
 * Whether an error from a kalaidoscope request means the cloud quota is
 * exhausted. Callers tag a 402 response as "quota_exhausted" before throwing.
 * Pure, no network.
 */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "quota_exhausted" || msg.toLowerCase().includes("quota");
}

export interface QuotaStatus {
  used: number;
  balance: number;
  expires: string | null;
}

export async function fetchQuota(): Promise<Result<QuotaStatus, Error>> {
  return withActiveClient((client) =>
    client.send<QuotaStatus>("/api/quota", {
      method: "GET",
      requestKey: null,
    }),
  );
}
