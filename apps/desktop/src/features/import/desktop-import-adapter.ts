import type { ImportAdapter } from "@kalaido/features/import";
import { err, ok } from "neverthrow";
import { classifyPath, readLocalFileFromDisk } from "@/api/app/ingest-file";
import { openFilePicker } from "@/api/app/os-integrations.ts";

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export const desktopImportAdapter: ImportAdapter = {
  async pickFile(filters) {
    const pickerResult = await openFilePicker(filters);
    if (pickerResult.isErr()) return err(pickerResult.error);
    const selected = pickerResult.value;
    if (typeof selected !== "string") return ok(null);

    return ok({
      displayPath: selected,
      filename: basename(selected),
      async readBlob() {
        const bytes = await readLocalFileFromDisk(selected);
        return bytes.map((buf) => new Blob([buf]));
      },
      scanEntries() {
        return classifyPath(selected);
      },
    });
  },
};
