import type { Result } from "neverthrow";
import { getDesktopHost } from "@/host";

export function downloadToFile(
  url: string,
  headers: Record<string, string>,
  destPath: string,
): Promise<Result<void, Error>> {
  return getDesktopHost().files.downloadToFile(url, headers, destPath);
}
