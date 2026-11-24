import { useCollection } from "@kalaido/hooks/use-collection";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kalaido/primitives/shadcn/dialog";
import { UploadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  type ImportAdapter,
  ImportColourField,
  type ImportColourChoice,
  ImportFields,
  isImportColourReady,
  useImportPicker,
  useImportSubmit,
} from "#import";

export interface ImportNotesDialogProps {
  open: boolean;
  onClose: () => void;
  onImportSuccess: (ingestId: string) => void;
  importAdapter: ImportAdapter;
}

export function ImportNotesDialog({
  open,
  onClose,
  onImportSuccess,
  importAdapter,
}: ImportNotesDialogProps) {
  const { submitting, submitError, submit, clearError } =
    useImportSubmit(onImportSuccess);
  const picker = useImportPicker(importAdapter, clearError);
  const [colour, setColour] = useState<ImportColourChoice>({ kind: "none" });
  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });

  function handleClose() {
    picker.clear();
    setColour({ kind: "none" });
    clearError();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={!submitting}
        className="flex max-h-[85vh] flex-col gap-4 overflow-hidden p-6 sm:max-w-xl"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Import your notes</DialogTitle>
          <DialogDescription>
            Bring in your personal notes, research papers, documents, or message
            archives to let Kalaido organise and index them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <ImportFields picker={picker} disabled={submitting} />
          <ImportColourField
            colours={colours.records}
            value={colour}
            onChange={setColour}
            disabled={submitting}
          />

          {submitError && (
            <p className="text-meta text-destructive">{submitError}</p>
          )}
        </div>

        <DialogFooter className="flex shrink-0 items-center justify-between border-t border-line pt-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="commit"
            disabled={
              !picker.file || submitting || !isImportColourReady(colour)
            }
            onClick={() => {
              if (picker.file) void submit(picker.file, colour);
            }}
          >
            <UploadSimpleIcon />
            {submitting ? "Uploading…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
