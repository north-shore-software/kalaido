import { Label } from "@/components/kalaido";
import {
  type ImportPicker,
  SUPPORTED_FORMATS_HINT,
} from "../hooks/use-import-picker";
import { FilePicker } from "./file-picker";
import { ImportPreview } from "./import-preview";

export interface ImportFieldsProps {
  picker: ImportPicker;
  disabled?: boolean;
}

/**
 * File field, format hint and scan preview — shared by the onboarding import
 * step and the dashboard import dialog so the two stay one surface.
 */
export function ImportFields({ picker, disabled }: ImportFieldsProps) {
  const { path, entries, scanning, pickError, chooseFile } = picker;
  return (
    <section className="flex flex-col gap-2">
      <Label>File</Label>
      <FilePicker path={path} disabled={disabled} onChoose={chooseFile} />
      <p className="text-body-sm text-fg-3">{SUPPORTED_FORMATS_HINT}</p>
      {pickError && <p className="text-body-sm text-fg-3">{pickError}</p>}
      {path && <ImportPreview entries={entries} scanning={scanning} />}
    </section>
  );
}
