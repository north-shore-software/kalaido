import { editReflectionWindowSnapshot } from "@kalaido/client/kalaidoscope/reflections";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kalaido/primitives/shadcn/dialog";
import { Textarea } from "@kalaido/primitives/shadcn/textarea";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type MutableRefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

export interface EditWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reflectionId: string;
  windowId: string;
  windowTitle: string;
  initialOutput: string;
  onSaved?: () => void;
}

function EditWindowDialogBody({
  reflectionId,
  windowId,
  windowTitle,
  initialOutput,
  busyRef,
  onSaved,
  onClose,
}: {
  reflectionId: string;
  windowId: string;
  windowTitle: string;
  initialOutput: string;
  busyRef: MutableRefObject<boolean>;
  onSaved?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialOutput);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const saveWrite = useExternalWrite<
    { output: string },
    { readonly id: string }
  >({
    execute: ({ output }) =>
      editReflectionWindowSnapshot(reflectionId, windowId, output),
    concurrency: "ignore",
  });

  useLayoutEffect(() => {
    busyRef.current = saveWrite.isPending;
    return () => {
      busyRef.current = false;
    };
  }, [busyRef, saveWrite.isPending]);

  const trimmed = draft.trim();
  const canSave =
    !saveWrite.isPending &&
    trimmed.length > 0 &&
    trimmed !== initialOutput.trim();

  async function handleSave() {
    if (!canSave) return;
    const outcome = await saveWrite.run({ output: trimmed });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to save edit", {
        description: outcome.error.message,
      });
      return;
    }
    toast.success("Revision saved");
    onSaved?.();
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit window summary</DialogTitle>
        <DialogDescription>
          {windowTitle} — saving appends a new revision while keeping previous
          versions in this window’s history.
        </DialogDescription>
      </DialogHeader>

      <div className="py-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saveWrite.isPending}
          placeholder="Write or edit the markdown summary for this window…"
          className="min-h-[280px] rounded-none font-sans text-body-sm"
        />
      </div>

      <DialogFooter>
        <Button
          size="sm"
          variant="outline"
          onClick={onClose}
          disabled={saveWrite.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="commit"
          onClick={() => void handleSave()}
          disabled={!canSave}
        >
          {saveWrite.isPending ? "Saving…" : "Save revision"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function EditWindowDialog({
  open,
  onOpenChange,
  reflectionId,
  windowId,
  windowTitle,
  initialOutput,
  onSaved,
}: EditWindowDialogProps) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [sessionKey, setSessionKey] = useState(0);
  const busyRef = useRef(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSessionKey((k) => k + 1);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && busyRef.current) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl rounded-none border-line bg-surface-2">
        <EditWindowDialogBody
          key={sessionKey}
          reflectionId={reflectionId}
          windowId={windowId}
          windowTitle={windowTitle}
          initialOutput={initialOutput}
          busyRef={busyRef}
          onSaved={onSaved}
          onClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
