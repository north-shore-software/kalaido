import { err, ok, type Result } from "neverthrow";
import { toError } from "@/lib/errors";

export async function tauriResult<T>(p: Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await p);
  } catch (e) {
    return err(toError(e));
  }
}
