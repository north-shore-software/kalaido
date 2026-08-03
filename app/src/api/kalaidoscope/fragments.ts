import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";
import type { FragmentTypeOptions } from "./types";

/**
 * Append a fragment to the kalaidoscope's ground truth. `occurredAt` defaults
 * server-side to the creation time. Resolves with the new fragment's id.
 */
export async function addFragment(
  type: FragmentTypeOptions,
  content: string,
  opts?: { source?: string; occurredAt?: string },
): Promise<Result<string, Error>> {
  return withActiveClient(async (client) => {
    const rec = await client.collection("fragment").create({
      type,
      content,
      ...(opts?.source ? { source: opts.source } : {}),
      ...(opts?.occurredAt ? { source_time: opts.occurredAt } : {}),
    });
    return rec.id;
  });
}
