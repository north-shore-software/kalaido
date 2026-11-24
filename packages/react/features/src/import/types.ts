import type { Result } from "neverthrow";

export type ImportFileKind = "text" | "docx" | "other";

export interface ImportFileEntry {
  path: string;
  kind: ImportFileKind;
}

export interface ImportFileFilter {
  name: string;
  extensions: string[];
}

export interface PickedImportFile {
  /** Display path or filename shown in the UI. */
  displayPath: string;
  /** Filename passed to the backend ingest endpoint. */
  filename: string;
  /** Reads the file contents as a Blob for upload. */
  readBlob: () => Promise<Result<Blob, Error>>;
  /** Optional pre-upload contents preview (e.g. desktop archive scan). */
  scanEntries?: () => Promise<Result<ImportFileEntry[], Error>>;
}

export interface ImportAdapter {
  /** Prompts the user to pick a file; returns `null` when cancelled. */
  pickFile: (
    filters: ImportFileFilter[],
  ) => Promise<Result<PickedImportFile | null, Error>>;
}

export type ImportColourChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

export function isImportColourReady(choice: ImportColourChoice): boolean {
  return choice.kind !== "new" || choice.name.trim() !== "";
}

export interface ImportRequest {
  file: PickedImportFile;
  colour?: ImportColourChoice;
  organizeAfter?: boolean;
}

export const FILE_FILTERS: ImportFileFilter[] = [
  { name: "Mailbox archive", extensions: ["mbox", "eml"] },
  { name: "Text", extensions: ["txt", "md", "text"] },
  { name: "Word document", extensions: ["docx"] },
  { name: "Zip archive", extensions: ["zip"] },
  { name: "All files", extensions: ["*"] },
];

/**
 * Prose form of FILE_FILTERS, derived so the import surfaces can't drift
 * from what the picker actually accepts.
 */
export const SUPPORTED_FORMATS_HINT = `Supported formats: ${FILE_FILTERS.filter(
  (f) => !f.extensions.includes("*"),
)
  .map((f) => `${f.name} (${f.extensions.map((e) => `.${e}`).join(", ")})`)
  .join(", ")}.`;

/** Compact form of FILE_FILTERS, e.g. ".mbox, .eml, .txt". */
export const SUPPORTED_EXTENSIONS_HINT = FILE_FILTERS.flatMap(
  (f) => f.extensions,
)
  .filter((e) => e !== "*")
  .map((e) => `.${e}`)
  .join(", ");
