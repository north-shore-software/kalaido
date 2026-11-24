import { invoke } from "@tauri-apps/api/core";
import type { Result } from "neverthrow";
import { tauriResult } from "@/api/app/_invoke.ts";

export type FileKind = "text" | "docx" | "other";

export interface FileEntry {
  path: string;
  kind: FileKind;
}

export function classifyPath(
  path: string,
): Promise<Result<FileEntry[], Error>> {
  return tauriResult(invoke<FileEntry[]>("classify_path", { path }));
}

export function readLocalFileFromDisk(
  path: string,
): Promise<Result<ArrayBuffer, Error>> {
  return tauriResult(invoke<ArrayBuffer>("read_file_bytes", { path }));
}
