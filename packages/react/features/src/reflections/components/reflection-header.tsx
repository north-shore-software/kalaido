import { updateReflection } from "@kalaido/client/kalaidoscope/reflections";
import { EditableText, Mono } from "@kalaido/primitives/kalaido";
import { useExternalWrite } from "@kalaido/state/live";
import type { ReactNode } from "react";
import { toast } from "sonner";

export interface ReflectionHeaderProps {
  reflectionId: string;
  name?: string;
  schedDisplay: {
    freq: string;
    win: string;
    scheduled: boolean;
  };
  /** Series-level actions: Refine, Refresh. */
  actions?: ReactNode;
}

export function ReflectionHeader({
  reflectionId,
  name,
  schedDisplay,
  actions,
}: ReflectionHeaderProps) {
  const renameWrite = useExternalWrite<string, void>({
    execute: async (next) =>
      (await updateReflection(reflectionId, { name: next })).map(
        () => undefined,
      ),
    concurrency: "ignore",
  });

  function rename(next: string) {
    void renameWrite.run(next).then((outcome) => {
      if (outcome.status === "error") {
        toast.error("Failed to rename", { description: outcome.error.message });
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
      <div className="flex items-center gap-3">
        <span className="size-4 bg-section rounded-none shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">
            <EditableText
              value={name || "Untitled reflection"}
              onCommit={rename}
            />
          </span>
          <Mono className="text-meta text-fg-4">
            {schedDisplay.freq} · last {schedDisplay.win} ·{" "}
            {schedDisplay.scheduled ? "auto-approved" : "manual"}
          </Mono>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
