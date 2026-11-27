import {
  getReflectionLens,
  updateReflectionLens,
} from "@kalaido/client/kalaidoscope/reflections";
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
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

export interface ReflectionLensDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reflectionId: string;
  /** Optional unsaved chat-drafted lens to prefill if no saved lens exists yet. */
  fallbackPrompt?: string;
  onSaved?: (prompt: string) => void;
}

function LensDialogBody({
  reflectionId,
  fallbackPrompt,
  busyRef,
  onSaved,
  onClose,
}: {
  reflectionId: string;
  fallbackPrompt?: string;
  busyRef: MutableRefObject<boolean>;
  onSaved?: (prompt: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const saveWrite = useExternalWrite<
    { id: string; prompt: string },
    { readonly id: string }
  >({
    execute: async ({ id, prompt }) =>
      (await updateReflectionLens(id, prompt)).map((r) => ({ id: r.lensId })),
    concurrency: "ignore",
  });

  useLayoutEffect(() => {
    busyRef.current = saveWrite.isPending;
    return () => {
      busyRef.current = false;
    };
  }, [busyRef, saveWrite.isPending]);

  useEffect(() => {
    let active = true;
    void getReflectionLens(reflectionId).then((res) => {
      if (!active) return;
      if (res.isOk()) {
        const prompt = res.value.prompt || fallbackPrompt || "";
        setInitialPrompt(res.value.prompt);
        setDraft(prompt);
      } else {
        toast.error("Failed to load standing lens", {
          description: res.error.message,
        });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reflectionId, fallbackPrompt]);

  const trimmed = draft.trim();
  const canSave =
    !loading &&
    !saveWrite.isPending &&
    trimmed.length > 0 &&
    trimmed !== initialPrompt.trim();

  async function handleSave() {
    if (!canSave) return;
    const outcome = await saveWrite.run({ id: reflectionId, prompt: trimmed });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to save standing lens", {
        description: outcome.error.message,
      });
      return;
    }
    toast.success("Standing lens updated");
    onSaved?.(trimmed);
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Standing lens</DialogTitle>
        <DialogDescription>
          This instruction runs independently against each window’s fragments.
          Saving updates future windows and flags older windows without
          overwriting them.
        </DialogDescription>
      </DialogHeader>

      <div className="py-2">
        {loading ? (
          <p className="py-8 text-center text-body-sm text-fg-3">
            Loading standing lens…
          </p>
        ) : (
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe how each time window's fragments should be summarized…"
            disabled={saveWrite.isPending}
            className="min-h-[240px] rounded-none font-sans text-body-sm"
          />
        )}
      </div>

      <DialogFooter>
        <Button
          size="sm"
          variant="outline"
          onClick={onClose}
          disabled={saveWrite.isPending}
        >
          Close
        </Button>
        <Button
          size="sm"
          variant="commit"
          onClick={() => void handleSave()}
          disabled={!canSave}
        >
          {saveWrite.isPending ? "Saving…" : "Save lens"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ReflectionLensDialog({
  open,
  onOpenChange,
  reflectionId,
  fallbackPrompt,
  onSaved,
}: ReflectionLensDialogProps) {
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
      <DialogContent className="max-w-xl rounded-none border-line bg-surface-2">
        <LensDialogBody
          key={sessionKey}
          reflectionId={reflectionId}
          fallbackPrompt={fallbackPrompt}
          busyRef={busyRef}
          onSaved={onSaved}
          onClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
