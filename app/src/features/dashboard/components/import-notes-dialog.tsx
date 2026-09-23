import { UploadSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportFields } from "@/features/import/components/import-fields";
import { useImportPicker } from "@/features/import/hooks/use-import-picker";
import { useImportSubmit } from "@/features/import/hooks/use-import-submit";

export interface ImportNotesDialogProps {
  open: boolean;
  onClose: () => void;
  onImportSuccess: (ingestId: string) => void;
}

export function ImportNotesDialog({
  open,
  onClose,
  onImportSuccess,
}: ImportNotesDialogProps) {
  const { submitting, submitError, submit, clearError } =
    useImportSubmit(onImportSuccess);
  const picker = useImportPicker(clearError);

  function handleClose() {
    picker.clear();
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
            disabled={!picker.path || submitting}
            onClick={() => void submit(picker.path)}
          >
            <UploadSimpleIcon />
            {submitting ? "Uploading…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
