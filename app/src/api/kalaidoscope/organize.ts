import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

/**
 * Kick the organize worker: recursively explores the finished workspace map,
 * creating projections/reflections directly as it decides on them (each
 * one's content generation starts in the background immediately) rather than
 * proposing a plan for later review. Returns as soon as the run is queued —
 * progress streams in via the organize_run realtime subscription.
 */
export async function startOrganize(): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send("/api/organize", { method: "POST" });
  });
}
