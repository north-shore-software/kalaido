import { useMemo } from "react";
import type { SnapshotEdit } from "@/api/kalaidoscope/projections";
import { EditDiffBoxes, StatusPill } from "@/components/kalaido";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/css-utils";

export interface SnapshotEditMarkersProps {
  edits: SnapshotEdit[];
  className?: string;
}

export function SnapshotEditMarkers({
  edits,
  className,
}: SnapshotEditMarkersProps) {
  const sorted = useMemo(() => {
    return [...edits].sort((a, b) => a.sequence - b.sequence);
  }, [edits]);

  const items = useMemo(() => {
    const approvedBlocks = new Set<number>();
    return sorted.map((edit) => {
      const isStacked =
        approvedBlocks.has(edit.blockIndex) || Boolean(edit.supersededBy);
      if (edit.status === "approved") {
        approvedBlocks.add(edit.blockIndex);
      }
      return { edit, isStacked };
    });
  }, [sorted]);

  if (items.length === 0) return null;

  return (
    <aside
      aria-label="Snapshot edits"
      className={cn("flex flex-col gap-2 shrink-0 w-48", className)}
    >
      <div className="text-meta text-fg-3 uppercase tracking-wider font-mono">
        Edits ({items.length})
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map(({ edit, isStacked }) => (
          <Popover key={edit.id}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "flex items-center justify-between gap-2 px-2.5 py-1.5 text-meta font-mono border rounded-none bg-surface-1 transition-colors hover:bg-surface-2 text-left w-full",
                    isStacked
                      ? "border-yellow-line text-yellow-ink"
                      : "border-line text-fg-2",
                  )}
                >
                  <span className="font-semibold">#{edit.sequence}</span>
                  <div className="flex items-center gap-1">
                    <StatusPill
                      kind={
                        edit.type === "manual"
                          ? "neutral"
                          : edit.type === "refinement"
                            ? "cyan"
                            : "magenta"
                      }
                    >
                      {edit.type}
                    </StatusPill>
                    {isStacked && (
                      <StatusPill kind="yellow">stacked</StatusPill>
                    )}
                  </div>
                </button>
              }
            />
            <PopoverContent align="end" side="left" className="w-80">
              <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-fg-3">#{edit.sequence}</span>
                  <StatusPill
                    kind={
                      edit.type === "manual"
                        ? "neutral"
                        : edit.type === "refinement"
                          ? "cyan"
                          : "magenta"
                    }
                  >
                    {edit.type}
                  </StatusPill>
                  {isStacked && <StatusPill kind="yellow">stacked</StatusPill>}
                </div>
                <span className="text-meta text-fg-4 font-mono">
                  block {edit.blockIndex}
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <EditDiffBoxes
                  before={edit.contentBefore}
                  after={edit.contentAfter}
                  variant="document"
                />
              </div>
            </PopoverContent>
          </Popover>
        ))}
      </div>
    </aside>
  );
}
