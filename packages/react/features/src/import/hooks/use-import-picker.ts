import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { useCallback } from "react";
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

interface ImportPickerState {
  file: PickedImportFile | null;
  entries: ImportFileEntry[];
  scanning: boolean;
  pickError: string;
}

type ImportPickerEvent =
  | { readonly type: "clear" }
  | { readonly type: "selectFile"; readonly file: PickedImportFile }
  | { readonly type: "startScan" }
  | { readonly type: "scanSuccess"; readonly entries: ImportFileEntry[] }
  | { readonly type: "scanError"; readonly message: string };

export function useImportPicker(adapter: ImportAdapter, onPicked?: () => void) {
  const handlers: ScopeHandlers<ImportPickerState, ImportPickerEvent> = {
    clear: (s) => {
      s.file = null;
      s.entries = [];
      s.scanning = false;
      s.pickError = "";
    },
    selectFile: (s, e) => {
      s.file = e.file;
      s.entries = [];
      s.pickError = "";
    },
    startScan: (s) => {
      s.scanning = true;
    },
    scanSuccess: (s, e) => {
      s.scanning = false;
      s.entries = e.entries;
    },
    scanError: (s, e) => {
      s.scanning = false;
      s.pickError = e.message;
    },
  };
  const scope = useScope({
    initial: (): ImportPickerState => ({
      file: null,
      entries: [],
      scanning: false,
      pickError: "",
    }),
    handlers,
  });

  const { file, entries, scanning, pickError } = useScopeState(scope);

  const clear = useCallback(() => {
    void scope.dispatch({ type: "clear" });
  }, [scope]);

  async function chooseFile() {
    const pickerResult = await adapter.pickFile(FILE_FILTERS);
    if (pickerResult.isErr()) return;
    const selected = pickerResult.value;
    if (!selected) return;

    await scope.dispatch({ type: "selectFile", file: selected });
    onPicked?.();

    if (!selected.scanEntries) return;

    // Preview the contents when the platform supports scanning. Failing to scan
    // doesn't block the import — the whole file is uploaded regardless, and the
    // backend infers the format per file from its name.
    await scope.dispatch({ type: "startScan" });
    const result = await selected.scanEntries();
    if (result.isErr()) {
      await scope.dispatch({
        type: "scanError",
        message: "Couldn't read that file to preview it.",
      });
      return;
    }
    await scope.dispatch({ type: "scanSuccess", entries: result.value });
  }

  return {
    file: file as PickedImportFile | null,
    path: file?.displayPath ?? "",
    entries: entries as ImportFileEntry[],
    scanning,
    pickError,
    chooseFile,
    clear,
  };
}
