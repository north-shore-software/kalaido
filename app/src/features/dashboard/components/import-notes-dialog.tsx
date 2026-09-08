import { UploadIcon } from "lucide-react";
import { useState } from "react";
import { ingestFile } from "@/api/kalaidoscope/ingest";
import { Label } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilePicker } from "@/features/import/components/file-picker";
import { ImportPreview } from "@/features/import/components/import-preview";
import { useImportPicker } from "@/features/import/hooks/use-import-picker";

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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { path, entries, scanning, pickError, chooseFile, clear } =
    useImportPicker(() => setSubmitError(""));

  function handleClose() {
    clear();
    setSubmitError("");
    setSubmitting(false);
    onClose();
  }

  async function runImport() {
    if (!path || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const created = await ingestFile({ path, organizeAfter: true });
    if (created.isErr()) {
      console.error("[import] ingest failed:", created.error);
      setSubmitError(created.error.message || "Import failed.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onImportSuccess(created.value.id);
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
          <section className="flex flex-col gap-2">
            <Label>File</Label>
            <FilePicker
              path={path}
              disabled={submitting}
              onChoose={chooseFile}
            />
            <p className="text-body-sm text-fg-3">
              Supported formats: Zip archives (.zip), Markdown &amp; plain text
              (.md, .txt), Word documents (.docx), and mailbox exports (.mbox,
              .eml).
            </p>
            {pickError && <p className="text-body-sm text-fg-3">{pickError}</p>}
            {path && <ImportPreview entries={entries} scanning={scanning} />}
          </section>

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
            disabled={!path || submitting}
            onClick={() => void runImport()}
          >
            <UploadIcon />
            {submitting ? "Uploading…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
