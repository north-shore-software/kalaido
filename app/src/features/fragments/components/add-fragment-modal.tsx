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
import { useNoteIngest } from "@/hooks/use-note-ingest";

interface AddFragmentModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddFragmentModal({ open, onClose }: AddFragmentModalProps) {
  const { phase, errorMsg, runIngest, reset } = useNoteIngest();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const saving = phase === "running";

  useEffect(() => {
    if (open) {
      setText("");
      reset();
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open, reset]);

  useEffect(() => {
    if (phase === "done") {
      onClose();
      reset();
    }
  }, [phase, onClose, reset]);

  function save() {
    if (!text.trim() || saving) return;
    void runIngest(text.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New Fragment</DialogTitle>
        </DialogHeader>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (phase === "error") reset();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Paste or type your content… (Enter to save, Shift+Enter for newline)"
          className="min-h-32"
        />
        {phase === "error" && errorMsg && (
          <p className="text-sm text-destructive break-words">{errorMsg}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!text.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
