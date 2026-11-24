import { useCallback, useState } from "react";
import {
  FILE_FILTERS,
  type ImportAdapter,
  type ImportFileEntry,
  type PickedImportFile,
  SUPPORTED_EXTENSIONS_HINT,
  SUPPORTED_FORMATS_HINT,
} from "../types";

export { SUPPORTED_EXTENSIONS_HINT, SUPPORTED_FORMATS_HINT };

export type ImportPicker = ReturnType<typeof useImportPicker>;

export function useImportPicker(
  adapter: ImportAdapter,
  onPicked?: () => void,
) {
  const [file, setFile] = useState<PickedImportFile | null>(null);
  const [entries, setEntries] = useState<ImportFileEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pickError, setPickError] = useState("");

  const clear = useCallback(() => {
    setFile(null);
    setEntries([]);
    setPickError("");
  }, []);

  async function chooseFile() {
    const pickerResult = await adapter.pickFile(FILE_FILTERS);
    if (pickerResult.isErr()) return;
    const selected = pickerResult.value;
    if (!selected) return;

    setFile(selected);
    setEntries([]);
    setPickError("");
    onPicked?.();

    if (!selected.scanEntries) return;

    // Preview the contents when the platform supports scanning. Failing to scan
    // doesn't block the import — the whole file is uploaded regardless, and the
    // backend infers the format per file from its name.
    setScanning(true);
    const result = await selected.scanEntries();
    setScanning(false);
    if (result.isErr()) {
      setPickError("Couldn't read that file to preview it.");
      return;
    }
    setEntries(result.value);
  }

  return {
    file,
    path: file?.displayPath ?? "",
    entries,
    scanning,
    pickError,
    chooseFile,
    clear,
  };
}
