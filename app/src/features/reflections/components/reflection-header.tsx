import type { ReactNode } from "react";
import { toast } from "sonner";
import { updateReflection } from "@/api/kalaidoscope/reflections";
import { EditableText, Mono } from "@/components/kalaido";

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
  function rename(next: string) {
    void updateReflection(reflectionId, { name: next }).then((res) => {
      if (res.isErr()) {
        toast.error("Failed to rename", { description: res.error.message });
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
