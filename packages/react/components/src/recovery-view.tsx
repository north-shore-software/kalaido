import type { StageError } from "@kalaido/client/lib/errors";
import { sendErrorReport } from "@kalaido/client/lib/posthog";
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
  PaperPlaneTiltIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

export interface RecoveryReportContext {
  containerId: string;
  workspaceName?: string | null;
  kalaidoscopeId?: string | null;
  route: string;
}

export interface RecoverySecondaryAction {
  label: string;
  onClick: () => void;
}

export interface RecoveryViewProps {
  title: string;
  description: string;
  error?: StageError | null;
  onRetry?: () => void;
  retryLabel?: string;
  allowReset?: boolean;
  resetNotice?: string;
  /** Runs before `host.settings.clear()` (e.g. detach bridges, dispose & flush root scope). */
  onBeforeClear?: () => Promise<void> | void;
  reportContext?: RecoveryReportContext;
  secondaryAction?: RecoverySecondaryAction;
  footer?: ReactNode;
}

export function RecoveryView({
  title,
  description,
  error,
  onRetry,
  retryLabel = "Try again",
  allowReset = true,
  resetNotice = "Clears all saved kalaidoscopes, preferences, and app state, then restarts.",
  onBeforeClear,
  reportContext,
  secondaryAction,
  footer,
}: RecoveryViewProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

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
            {reportContext && (
              <SendErrorReportButton
                title={title}
                error={error}
                context={reportContext}
                disabled={resetting}
                onError={setReportError}
              />
            )}
            {secondaryAction && (
              <Button
                size="sm"
                variant="outline"
                onClick={secondaryAction.onClick}
                disabled={resetting}
              >
                {secondaryAction.label}
              </Button>
            )}
            {allowReset && (
              <ResetSettingsActions
                confirming={confirmingReset}
                resetting={resetting}
                onRequestConfirm={() => setConfirmingReset(true)}
                onCancelConfirm={() => setConfirmingReset(false)}
                onConfirm={() => void handleReset()}
              />
            )}
          </div>

          {allowReset && confirmingReset && !resetError && (
            <p className="text-meta text-muted-foreground">{resetNotice}</p>
          )}
          {resetError && (
            <p className="text-meta text-destructive">{resetError}</p>
          )}
          {reportError && (
            <p className="text-meta text-destructive">{reportError}</p>
          )}

          {footer}
        </div>
      </div>
    </div>
  );
}

function SendErrorReportButton({
  title,
  error,
  context,
  disabled,
  onError,
}: {
  title: string;
  error?: StageError | null;
  context: RecoveryReportContext;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSend() {
    setPhase("sending");
    onError(null);
    const diagResult = await getHost().diagnostics.collect({
      kalaidoscopeId: context.kalaidoscopeId ?? context.containerId,
      kalaidoscopeType: "cloud",
      route: context.route,
    });
    const sent = sendErrorReport(error ?? { message: title }, {
      containerId: context.containerId,
      workspaceName: context.workspaceName,
      diagnostics: diagResult.unwrapOr(null),
    });
    if (sent.isErr()) {
      setPhase("idle");
      onError(sent.error.message);
      return;
    }
    setPhase("sent");
    toast.success("Error report sent", {
      description: "Thank you — we'll look into it.",
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void handleSend()}
      disabled={disabled || phase !== "idle"}
    >
      {phase === "sending" ? (
        <>
          <Spinner />
          Sending…
        </>
      ) : phase === "sent" ? (
        <>
          <CheckIcon />
          Report sent
        </>
      ) : (
        <>
          <PaperPlaneTiltIcon />
          Send error report
        </>
      )}
    </Button>
  );
}

function ResetSettingsActions({
  confirming,
  resetting,
  onRequestConfirm,
  onCancelConfirm,
  onConfirm,
}: {
  confirming: boolean;
  resetting: boolean;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}) {
  if (confirming) {
    return (
      <>
        <Button
          size="sm"
          variant="destructive"
          onClick={onConfirm}
          disabled={resetting}
        >
          {resetting ? <Spinner /> : "Yes, reset everything"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancelConfirm}
          disabled={resetting}
        >
          Cancel
        </Button>
      </>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onRequestConfirm}
      disabled={resetting}
    >
      Reset app settings
    </Button>
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
