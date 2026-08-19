import { CheckIcon, ChevronRight, CopyIcon, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useSnapshot } from "valtio/react";
import { reloadAppWindow } from "@/api/app/os-integrations.ts";
import { resetAppSettings } from "@/api/app/settings.ts";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { KalaidoscopeList } from "@/features/create-kalaidoscope/components/kalaidoscope-list";
import { appState, type StageError } from "@/hooks/use-app-state.ts";

export interface RecoveryScreenProps {
  title: string;
  description: string;
  error?: StageError | null;
  onRetry?: () => void;
  retryLabel?: string;
  allowSwitch?: boolean;
  excludeKalaidoscopeId?: string;
  onSwitched?: () => void;
}

export function RecoveryScreen({
  title,
  description,
  error,
  onRetry,
  retryLabel = "Try again",
  allowSwitch = false,
  excludeKalaidoscopeId,
  onSwitched,
}: RecoveryScreenProps) {
  const { availableKalaidoscopes } = useSnapshot(appState);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const showSwitcher =
    allowSwitch &&
    availableKalaidoscopes.some((k) => k.id !== excludeKalaidoscopeId);

  async function handleReset() {
    setResetting(true);
    setResetError(null);
    const result = await resetAppSettings();
    if (result.isErr()) {
      setResetError(result.error.message);
      setResetting(false);
      return;
    }
    reloadAppWindow();
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-auto bg-background">
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex w-full max-w-lg flex-col gap-5">
          <div className="flex items-center gap-3">
            <TriangleAlert className="size-6 shrink-0 text-destructive" />
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
            <p className="text-meta text-muted-foreground">
              Clears all saved kalaidoscopes, preferences, and app state, then
              restarts. Kalaidoscope data directories on disk are not deleted.
            </p>
          )}
          {resetError && (
            <p className="text-meta text-destructive">{resetError}</p>
          )}

          {showSwitcher && (
            <div className="flex flex-col gap-2 border-t pt-5">
              <span className="text-label uppercase text-muted-foreground">
                Open a different kalaidoscope
              </span>
              <KalaidoscopeList
                className="flex flex-col"
                excludeId={excludeKalaidoscopeId}
                onSwitched={onSwitched}
              />
            </div>
          )}
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
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        Error details
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col items-start gap-2">
        <pre className="max-h-48 w-full overflow-auto rounded-md border bg-surface-2 p-3 text-mono-sm leading-relaxed whitespace-pre-wrap">
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
