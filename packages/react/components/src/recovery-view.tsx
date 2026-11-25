import type { StageError } from "@kalaido/client/lib/errors";
import { getHost } from "@kalaido/platform";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@kalaido/primitives/shadcn/collapsible";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import {
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

export interface RecoveryViewProps {
  title: string;
  description: string;
  error?: StageError | null;
  onRetry?: () => void;
  retryLabel?: string;
  resetNotice?: string;
  /** Runs before `host.settings.clear()` (e.g. detach bridges, dispose & flush root scope). */
  onBeforeClear?: () => Promise<void> | void;
  footer?: ReactNode;
}

export function RecoveryView({
  title,
  description,
  error,
  onRetry,
  retryLabel = "Try again",
  resetNotice = "Clears all saved kalaidoscopes, preferences, and app state, then restarts.",
  onBeforeClear,
  footer,
}: RecoveryViewProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleReset() {
    setResetting(true);
    setResetError(null);
    if (onBeforeClear) {
      try {
        await onBeforeClear();
      } catch (e) {
        console.error("RecoveryView: onBeforeClear failed:", e);
      }
    }
    const host = getHost();
    const result = await host.settings.clear();
    if (result.isErr()) {
      setResetError(result.error.message);
      setResetting(false);
      return;
    }
    host.reload();
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-auto bg-background">
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex w-full max-w-lg flex-col gap-5">
          <div className="flex items-center gap-3">
            <WarningIcon className="size-6 shrink-0 text-destructive" />
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          </div>

          <p className="text-body-sm text-muted-foreground">{description}</p>

          {error && <ErrorDetails error={error} />}

          <div className="flex flex-wrap items-center gap-2">
            {onRetry && (
              <Button size="sm" onClick={onRetry} disabled={resetting}>
                {retryLabel}
              </Button>
            )}
            {confirmingReset ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleReset()}
                  disabled={resetting}
                >
                  {resetting ? <Spinner /> : "Yes, reset everything"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingReset(false)}
                  disabled={resetting}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmingReset(true)}
                disabled={resetting}
              >
                Reset app settings
              </Button>
            )}
          </div>

          {confirmingReset && !resetError && (
            <p className="text-meta text-muted-foreground">{resetNotice}</p>
          )}
          {resetError && (
            <p className="text-meta text-destructive">{resetError}</p>
          )}

          {footer}
        </div>
      </div>
    </div>
  );
}

function ErrorDetails({ error }: { error: StageError }) {
  const [copied, setCopied] = useState(false);
  const text = error.detail
    ? `${error.message}\n\n${error.detail}`
    : error.message;

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Collapsible className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
        <CaretRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        Error details
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col items-start gap-2">
        <pre className="max-h-48 w-full overflow-auto rounded-none border bg-surface-2 p-3 text-mono-sm leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
        <Button size="sm" variant="ghost" onClick={() => void handleCopy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy error details"}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
