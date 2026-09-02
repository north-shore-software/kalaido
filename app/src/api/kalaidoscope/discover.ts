import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

export type DiscoverKind = "projections" | "reflections" | "colours";

export async function startDiscover(
  kind: DiscoverKind,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send("/api/discover", { method: "POST", body: { kind } });
  });
}
