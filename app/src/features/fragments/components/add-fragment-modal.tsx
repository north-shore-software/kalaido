import {
  FileTextIcon,
  PlusCircleIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ImportPreview } from "@/features/import/components/import-preview";
import { useImportPicker } from "@/features/import/hooks/use-import-picker";
import { useImportSubmit } from "@/features/import/hooks/use-import-submit";
import { useNoteIngest } from "@/hooks/use-note-ingest";
import { cn } from "@/lib/css-utils";

interface AddFragmentModalProps {
  open: boolean;
  onClose: () => void;
}

type FragmentTab = "write" | "import";

export function AddFragmentModal({ open, onClose }: AddFragmentModalProps) {
  const [tab, setTab] = useState<FragmentTab>("write");
  const { phase, errorMsg, runIngest, reset: resetNote } = useNoteIngest();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saving = phase === "running";

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const {
    submitting: importSubmitting,
    submitError: importError,
    submit: submitImport,
    clearError: clearImportError,
  } = useImportSubmit(() => {
    picker.clear();
    onCloseRef.current();
  });
  const picker = useImportPicker(clearImportError);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setText("");
      resetNote();
      picker.clear();
      clearImportError();
      if (tab === "write") {
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    }
    wasOpenRef.current = open;
  }, [open, resetNote, picker, clearImportError, tab]);

  useEffect(() => {
    if (phase === "done") {
      onClose();
      resetNote();
    }
  }, [phase, onClose, resetNote]);

  function save() {
    if (!text.trim() || saving) return;
    void runIngest(text.trim());
  }

  function handleImport() {
    if (!picker.path || importSubmitting) return;
    void submitImport(picker.path);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  }

  function handleClose() {
    if (saving || importSubmitting) return;
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex w-full flex-col gap-4 border-line border-t-2 border-t-cyan bg-popover p-6 sm:w-[560px] sm:max-w-[560px]"
      >
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-none border border-cyan-edge bg-cyan-wash text-cyan">
              <PlusCircleIcon weight="fill" className="size-5" />
            </div>
            <DialogTitle className="text-card-title font-bold text-fg-1">
              New Fragment
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex w-full min-w-0 flex-col gap-4">
          <div className="grid w-full shrink-0 grid-cols-2 rounded-none border border-line bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => {
                setTab("write");
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
              className={cn(
                "flex h-9 items-center justify-center rounded-none text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer",
                tab === "write"
                  ? "border border-cyan-edge bg-cyan-wash text-cyan"
                  : "text-fg-3 hover:text-fg-1",
              )}
            >
              Start writing
            </button>
            <button
              type="button"
              onClick={() => setTab("import")}
              className={cn(
                "flex h-9 items-center justify-center rounded-none text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer",
                tab === "import"
                  ? "border border-cyan-edge bg-cyan-wash text-cyan"
                  : "text-fg-3 hover:text-fg-1",
              )}
            >
              Import file
            </button>
          </div>

          <div className="h-[260px] w-full min-w-0">
            {tab === "write" ? (
              <div className="flex h-full w-full min-w-0 flex-col gap-2">
                <div className="flex flex-1 flex-col rounded-none border border-line bg-surface-1 p-3 transition-colors focus-within:border-cyan">
                  <Textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (phase === "error") resetNote();
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Paste or type your content… (Enter to save, Shift+Enter for newline)"
                    className="h-full min-h-0 w-full resize-none border-none p-0 text-body focus-visible:ring-0"
                  />
                </div>
                {phase === "error" && errorMsg && (
                  <p className="text-sm text-destructive break-words">
                    {errorMsg}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex h-full w-full min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                {!picker.path ? (
                  <button
                    type="button"
                    onClick={() => void picker.chooseFile()}
                    disabled={importSubmitting}
                    className="group flex flex-1 flex-col items-center justify-center gap-3 rounded-none border border-dashed border-line-strong bg-surface-1 p-6 text-center transition-colors hover:border-cyan hover:bg-cyan-wash/20 cursor-pointer"
                  >
                    <div className="flex size-12 items-center justify-center rounded-none border border-line bg-surface-2 text-fg-3 transition-colors group-hover:border-cyan group-hover:text-cyan">
                      <UploadSimpleIcon className="size-6" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-row font-semibold text-fg-1 transition-colors group-hover:text-cyan">
                        Choose a file to import
                      </span>
                      <span className="text-meta text-fg-4">
                        .txt, .md, .docx, .zip, .mbox, .eml
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className="flex w-full min-w-0 flex-col gap-3">
                    <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-none border border-cyan-edge bg-cyan-veil p-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-none border border-cyan-edge bg-surface-1 text-cyan">
                        <FileTextIcon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div
                          className="truncate text-body-sm font-semibold text-fg-1"
                          title={picker.path}
                        >
                          {picker.path.split(/[\\/]/).pop()}
                        </div>
                        <div
                          className="truncate font-mono text-meta text-fg-4"
                          title={picker.path}
                        >
                          {picker.path}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void picker.chooseFile()}
                        disabled={importSubmitting}
                        className="shrink-0 text-fg-3 hover:text-fg-1"
                      >
                        Change
                      </Button>
                    </div>
                    <ImportPreview
                      entries={picker.entries}
                      scanning={picker.scanning}
                    />
                  </div>
                )}
                {picker.pickError && (
                  <p className="text-sm text-destructive break-words">
                    {picker.pickError}
                  </p>
                )}
                {importError && (
                  <p className="text-sm text-destructive break-words">
                    {importError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2 flex shrink-0 items-center justify-between border-t border-line pt-3 sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={saving || importSubmitting}
          >
            Cancel
          </Button>
          {tab === "write" ? (
            <Button
              onClick={save}
              disabled={!text.trim() || saving}
              className="border-transparent bg-cyan font-bold text-cyan-foreground hover:opacity-85"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={!picker.path || importSubmitting}
              className="border-transparent bg-cyan font-bold text-cyan-foreground hover:opacity-85"
            >
              <UploadSimpleIcon className="size-4" />
              {importSubmitting ? "Uploading…" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
