import { CaretRightIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
  type FeedbackDiagnostics,
  getFeedbackDiagnostics,
} from "@/api/app/feedback.ts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveKalaidoscope } from "@/hooks/use-active-kalaidoscope";
import { sendFeedback } from "@/lib/posthog";
import { useCurrentPathname } from "@/routes/use-current-pathname";

export interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const kalaidoscope = useActiveKalaidoscope();
  const kalaidoscopeId = kalaidoscope?.id ?? null;
  const kalaidoscopeType = kalaidoscope?.type ?? null;
  const route = useCurrentPathname();
  const diagnosticsId = useId();
  const [message, setMessage] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [diagnostics, setDiagnostics] = useState<FeedbackDiagnostics | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDiagnostics(null);
    void getFeedbackDiagnostics({
      kalaidoscopeId,
      kalaidoscopeType,
      route,
    }).then((result) => {
      if (cancelled) return;
      if (result.isOk()) setDiagnostics(result.value);
      else setError(`Couldn't collect diagnostics: ${result.error.message}`);
    });
    return () => {
      cancelled = true;
    };
  }, [open, kalaidoscopeId, kalaidoscopeType, route]);

  const collecting = includeDiagnostics && diagnostics === null && !error;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setMessage("");
      setIncludeDiagnostics(true);
      setError(null);
    }
    onOpenChange(next);
  }

  function handleSend() {
    const result = sendFeedback(
      message.trim(),
      includeDiagnostics ? diagnostics : null,
    );
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    toast.success("Feedback sent", { description: "Thank you." });
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden p-6 sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Tell us what went wrong, or what you'd like to see.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Your feedback"
            className="min-h-24"
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id={diagnosticsId}
              checked={includeDiagnostics}
              onCheckedChange={setIncludeDiagnostics}
            />
            <Label htmlFor={diagnosticsId}>Include diagnostics</Label>
          </div>
          {includeDiagnostics && (
            <Collapsible className="flex flex-col gap-2">
              <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
                <CaretRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                Show what's sent
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="max-h-48 w-full overflow-auto rounded-none border bg-surface-2 p-3 text-mono-sm leading-relaxed whitespace-pre-wrap">
                  {diagnostics
                    ? JSON.stringify(diagnostics, null, 2)
                    : "Collecting…"}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
          {error && <p className="text-meta text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex shrink-0 items-center justify-between border-t border-line pt-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="commit"
            disabled={!message.trim() || collecting}
            onClick={handleSend}
          >
            <PaperPlaneTiltIcon />
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
