import type { LocalFileEntry, LocalFileKind } from "@kalaido/platform";
import type { Result } from "neverthrow";
import { getDesktopHost } from "@/host";

export type FileKind = LocalFileKind;
export type FileEntry = LocalFileEntry;

export function classifyPath(
  path: string,
): Promise<Result<FileEntry[], Error>> {
  return getDesktopHost().files.classifyPath(path);
}

export function readLocalFileFromDisk(
  path: string,
): Promise<Result<ArrayBuffer, Error>> {
  return getDesktopHost().files.readBytes(path);
}
