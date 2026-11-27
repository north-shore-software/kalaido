import {
  getProjectionLens,
  updateProjectionLens,
} from "@kalaido/client/kalaidoscope/projections";
import { Pill } from "@kalaido/primitives/kalaido";
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

export interface ProjectionBriefDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectionId: string;
}

function BriefDialogBody({
  projectionId,
  busyRef,
  onClose,
}: {
  projectionId: string;
  busyRef: MutableRefObject<boolean>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const saveWrite = useExternalWrite<
    { id: string; prompt: string },
    { readonly id: string }
  >({
    execute: async ({ id, prompt }) =>
      (await updateProjectionLens(id, prompt)).map((r) => ({ id: r.lensId })),
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
    void getProjectionLens(projectionId).then((res) => {
      if (!active) return;
      if (res.isOk()) {
        setInitialPrompt(res.value.prompt);
        setDraft(res.value.prompt);
        setUpdating(res.value.updating);
      } else {
        toast.error("Failed to load brief", {
          description: res.error.message,
        });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectionId]);

  // Poll gently while async post-Save brief distillation is still in flight.
  useEffect(() => {
    if (!updating) return;
    let active = true;
    const timer = window.setInterval(() => {
      void getProjectionLens(projectionId).then((res) => {
        if (!active || res.isErr()) return;
        setUpdating(res.value.updating);
        if (!dirty) {
          setInitialPrompt(res.value.prompt);
          setDraft(res.value.prompt);
        }
      });
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [updating, projectionId, dirty]);

  const trimmed = draft.trim();
  const canSave =
    !loading &&
    !saveWrite.isPending &&
    trimmed.length > 0 &&
    trimmed !== initialPrompt.trim();

  async function handleSave() {
    if (!canSave) return;
    const outcome = await saveWrite.run({ id: projectionId, prompt: trimmed });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to save brief", {
        description: outcome.error.message,
      });
      return;
    }
    toast.success("Brief updated");
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 pr-6">
          <DialogTitle>Editorial brief</DialogTitle>
          {updating && (
            <Pill tone="primary" dot>
              Updating brief…
            </Pill>
          )}
        </div>
        <DialogDescription>
          Standing guidance distilled from your saved drafts — used when
          updating this projection with new sources.
        </DialogDescription>
      </DialogHeader>

      <div className="py-2">
        {loading ? (
          <p className="py-8 text-center text-body-sm text-fg-3">
            Loading brief…
          </p>
        ) : (
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            placeholder={
              updating
                ? "Distilling editorial brief from your saved draft…"
                : "No editorial brief yet. Describe the purpose, structure, tone, and inclusion rules for future updates…"
            }
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
          {saveWrite.isPending ? "Saving…" : "Save brief"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ProjectionBriefDialog({
  open,
  onOpenChange,
  projectionId,
}: ProjectionBriefDialogProps) {
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
        <BriefDialogBody
          key={sessionKey}
          projectionId={projectionId}
          busyRef={busyRef}
          onClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
