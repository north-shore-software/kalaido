import { err, ok, type Result } from "neverthrow";
import type { TypedPocketBase } from "@/api/kalaidoscope/types";
import { getActiveKalaidoscopeClient } from "@/lib/active-kalaidoscope-client";
import { toError } from "@/lib/errors";

export { toError };

/** The client for the currently open kalaidoscope; err when none is open. */
export function activeClient(): Result<TypedPocketBase, Error> {
  const client = getActiveKalaidoscopeClient();
  return client ? ok(client) : err(new Error("No kalaidoscope is open"));
}

/**
 * Run `fn` with the active kalaidoscope client, normalizing the two failure
 * modes every PocketBase call shares: no kalaidoscope open, or a thrown request
 * error. Collapses the `activeClient()` guard + try/catch boilerplate.
 */
export async function withActiveClient<T>(
  fn: (client: TypedPocketBase) => Promise<T>,
): Promise<Result<T, Error>> {
  const client = activeClient();
  if (client.isErr()) return err(client.error);
  try {
    return ok(await fn(client.value));
  } catch (e) {
    return err(toError(e));
  }
}
