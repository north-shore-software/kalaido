import wordmarkSrc from "@kalaido/brand/kalaido-wordmark-signature-dark.svg";
import type { StageError } from "@kalaido/client/lib/errors";
import { Mark } from "@kalaido/primitives/kalaido";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import { ArrowLeftIcon, WarningIcon } from "@phosphor-icons/react";

export interface SplashScreenProps {
  workspaceName?: string | null;
  statusText?: string | null;
  error?: StageError | null;
  onRetry?: () => void;
  onBack?: () => void;
  retryLabel?: string;
  backLabel?: string;
}

export function SplashScreen({
  workspaceName,
  statusText,
  error,
  onRetry,
  onBack,
  retryLabel = "Try again",
  backLabel = "Back",
}: SplashScreenProps = {}) {
  const showContainerStartup = Boolean(workspaceName || statusText || error);

  if (!showContainerStartup) {
    return (
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-700",
          "opacity-100",
        )}
      >
        <img
          src={wordmarkSrc}
          alt="Kalaido"
          draggable={false}
          className="h-12 w-auto select-none object-contain animate-in fade-in duration-1000 ease-out"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <Mark className="size-14 p-1.5 animate-glow-shimmer" />
        <div className="flex flex-col items-center gap-2">
          {workspaceName && (
            <h1 className="text-xl font-semibold tracking-tight text-fg-1">
              {workspaceName}
            </h1>
          )}
          {error ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 text-destructive">
                <WarningIcon className="size-4 shrink-0" />
                <p className="text-body-sm">
                  {statusText ?? "Failed to start cloud container."}
                </p>
              </div>
              <p className="text-meta text-muted-foreground">{error.message}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" />
              <p className="font-mono text-mono-sm">
                {statusText ?? "Starting cloud container…"}
              </p>
            </div>
          )}
        </div>
        {error && (onRetry || onBack) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
            {onBack && (
              <Button size="sm" variant="outline" onClick={onBack}>
                <ArrowLeftIcon className="size-3.5" />
                {backLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
