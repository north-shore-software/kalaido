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

interface EditCandidateModalProps {
  open: boolean;
  /** The raw markdown of the selected blocks, exactly as the candidate has it. */
  oldText: string;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (newText: string) => void;
}

/**
 * Hand-edit a passage of a pending candidate. Deliberately plain — the
 * selection and editing UX is to be iterated separately; this is the
 * mechanism. The text is markdown, so Enter inserts a newline and
 * Cmd/Ctrl+Enter submits.
 */
export function EditCandidateModal({
  open,
  oldText,
  saving,
  error,
  onClose,
  onSubmit,
}: EditCandidateModalProps) {
  const [text, setText] = useState(oldText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText(oldText);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open, oldText]);

  const unchanged = text === oldText;

  function submit() {
    if (unchanged || saving) return;
    onSubmit(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit selection</DialogTitle>
        </DialogHeader>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-64 font-mono text-sm focus-visible:border-b-magenta"
          disabled={saving}
        />
        <p className="text-meta text-fg-3">
          Replaces exactly this passage in the candidate. The edit is kept as a
          fragment so later regenerations respect it. Cmd/Ctrl+Enter to apply.
        </p>
        {error && (
          <p className="text-sm text-destructive break-words">{error}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="commit"
            onClick={submit}
            disabled={unchanged || saving}
          >
            {saving ? "Applying…" : "Apply edit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
