import { type RefObject, useRef, useState } from "react";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kalaido/primitives/shadcn/dialog";
import { Textarea } from "@kalaido/primitives/shadcn/textarea";

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
  const [prevOpen, setPrevOpen] = useState(open);
  const [sessionKey, setSessionKey] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSessionKey((k) => k + 1);
    }
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent
        showCloseButton={false}
        initialFocus={textareaRef}
        className="sm:max-w-2xl"
      >
        <EditCandidateForm
          key={`${sessionKey}:${oldText}`}
          oldText={oldText}
          saving={saving}
          error={error}
          onClose={onClose}
          onSubmit={onSubmit}
          textareaRef={textareaRef}
        />
      </DialogContent>
    </Dialog>
  );
}

interface EditCandidateFormProps {
  oldText: string;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (newText: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

function EditCandidateForm({
  oldText,
  saving,
  error,
  onClose,
  onSubmit,
  textareaRef,
}: EditCandidateFormProps) {
  const [text, setText] = useState(oldText);
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
    <>
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
      {error && <p className="text-sm text-destructive break-words">{error}</p>}
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
    </>
  );
}
