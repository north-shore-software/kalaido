import wordmarkSrc from "@kalaido/brand/kalaido-wordmark-signature-dark.svg";
import { Mark } from "@kalaido/primitives/kalaido";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";

export interface SplashScreenProps {
  workspaceName?: string | null;
  statusText?: string | null;
}

export function SplashScreen({
  workspaceName,
  statusText,
}: SplashScreenProps = {}) {
  if (!workspaceName && !statusText) {
    return (
      <div
        className={cn(
          "fixed inset-0 z-40 flex items-center justify-center bg-background transition-opacity duration-700",
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
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <Mark className="size-14 p-1.5 animate-glow-shimmer" />
        <div className="flex flex-col items-center gap-2">
          {workspaceName && (
            <h1 className="text-xl font-semibold tracking-tight text-fg-1">
              {workspaceName}
            </h1>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <p className="font-mono text-mono-sm">
              {statusText ?? "Starting cloud container…"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
