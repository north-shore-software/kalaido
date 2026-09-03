import { CheckIcon, TriangleAlert } from "lucide-react";
import type { IngestPhase } from "@/api/kalaidoscope/ingest";
import { Spinner } from "@/components/ui/spinner";

export interface ImportStatusProps {
  phase: IngestPhase;
  imported?: number;
  errorMsg?: string;
}

export function ImportStatus({ phase, imported, errorMsg }: ImportStatusProps) {
  if (phase === "idle") return null;

  const running = phase === "running";

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-6">
      {running && (
        <p className="flex items-center gap-2 text-body-sm text-fg-3">
          <Spinner className="size-4" />
          Importing…
        </p>
      )}

      {phase === "done" && (
        <p className="flex items-center gap-2 text-body-sm text-fg-1">
          <CheckIcon className="size-4 text-stable" />
          Imported {imported} {imported === 1 ? "fragment" : "fragments"}.
        </p>
      )}

      {phase === "cancelled" && (
        <p className="text-body-sm text-fg-4">
          Cancelled. Any import already accepted keeps running on the server.
        </p>
      )}

      {phase === "error" && (
        <p className="flex items-center gap-2 break-words text-body-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {errorMsg}
        </p>
      )}
    </section>
  );
}
