import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

export async function startMap(): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send("/api/map", { method: "POST" });
  });
}
