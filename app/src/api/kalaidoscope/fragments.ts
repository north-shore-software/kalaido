import { err, ok, type Result } from "neverthrow";
import { activeClient, toError } from "./_active";
import { kalaidoscopeAuthHeaders } from "./client";
import type { FragmentTypeOptions } from "./types";

/**
 * Append a fragment to the kalaidoscope's ground truth. `occurredAt` defaults
 * server-side to the creation time. Resolves with the new fragment's id.
 */
export async function addFragment(
  type: FragmentTypeOptions,
  content: string,
  opts?: { source?: string; occurredAt?: string; origin?: string },
): Promise<Result<string, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);
  const baseURL = client.value.baseURL;

  try {
    const res = await fetch(`${baseURL}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await kalaidoscopeAuthHeaders(baseURL)),
      },
      body: JSON.stringify({
        type,
        content,
        origin: opts?.origin ?? "app",
        source: opts?.source,
        source_time: opts?.occurredAt,
      }),
    });
    if (!res.ok) {
      let msg = `Ingest failed: ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) msg = body.message;
      } catch {}
      return err(new Error(msg));
    }
    const data = (await res.json()) as { fragmentId: string };
    return ok(data.fragmentId);
  } catch (e) {
    return err(toError(e));
  }
}
