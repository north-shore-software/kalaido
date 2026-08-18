import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

/**
 * Start a speculative "generate all" wave: the backend drains the stale set in
 * dependency order, generating each entity against its upstreams' latest
 * output even when that output is still an unapproved candidate. Returns as
 * soon as the wave is queued — candidates arrive through the ordinary realtime
 * subscriptions, and queue activity shows in the utility bar.
 */
export async function startReconcile(): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send("/api/reconcile", { method: "POST" });
  });
}
