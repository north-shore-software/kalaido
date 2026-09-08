import { useState } from "react";
import { classifyPath, type FileEntry } from "@/api/app/ingest-file";
import { openFilePicker } from "@/api/app/os-integrations.ts";

const FILE_FILTERS = [
  { name: "Mailbox archive", extensions: ["mbox", "eml"] },
  { name: "Text", extensions: ["txt", "md", "text"] },
  { name: "Word document", extensions: ["docx"] },
  { name: "Zip archive", extensions: ["zip"] },
  { name: "All files", extensions: ["*"] },
];

/**
 * Prose form of FILE_FILTERS, derived so the two import surfaces can't drift
 * from what the picker actually accepts.
 */
export const SUPPORTED_FORMATS_HINT = `Supported formats: ${FILE_FILTERS.filter(
  (f) => !f.extensions.includes("*"),
)
  .map((f) => `${f.name} (${f.extensions.map((e) => `.${e}`).join(", ")})`)
  .join(", ")}.`;

export type ImportPicker = ReturnType<typeof useImportPicker>;

export function useImportPicker(onPicked?: () => void) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pickError, setPickError] = useState("");

  function clear() {
    setPath("");
    setEntries([]);
    setPickError("");
  }

  async function chooseFile() {
    const pickerResult = await openFilePicker(FILE_FILTERS);
    if (pickerResult.isErr()) return;
    const selected = pickerResult.value;
    if (typeof selected !== "string") return;

    setPath(selected);
    setEntries([]);
    setPickError("");
    onPicked?.();

    // Preview the contents via the Rust host's classify_path. Failing to scan
    // doesn't block the import — the whole file is uploaded regardless, and the
    // backend infers the format per file from its name.
    setScanning(true);
    const result = await classifyPath(selected);
    setScanning(false);
    if (result.isErr()) {
      setPickError("Couldn't read that file to preview it.");
      return;
    }
    setEntries(result.value);
  }

  return { path, entries, scanning, pickError, chooseFile, clear };
}
