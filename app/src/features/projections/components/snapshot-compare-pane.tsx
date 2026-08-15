import { StatusPill } from "@/components/kalaido";

export interface SnapshotComparePaneProps {
  currentContent?: string;
  pendingContent?: string;
  refining?: boolean;
}

export function SnapshotComparePane({
  currentContent,
  pendingContent,
  refining = false,
}: SnapshotComparePaneProps) {
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col border-r border-line">
        <div className="flex h-11 shrink-0 items-center border-b border-line px-5">
          <span className="flex items-center gap-1.5 font-mono text-label font-semibold text-fg-3 uppercase">
            <span className="size-[5px] rounded-full bg-fg-3" />
            current
          </span>
        </div>
        <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-body text-fg-2">
          {currentContent || (
            <span className="text-fg-4">No live snapshot yet.</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col border-l-[3px] border-l-magenta bg-magenta-veil">
        <div className="flex h-11 shrink-0 items-center border-b border-magenta-edge px-5">
          <StatusPill kind="magenta">
            {refining ? "refined" : "pending"}
          </StatusPill>
        </div>
        <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-body text-fg-1">
          {pendingContent || "(empty candidate)"}
        </div>
      </div>
    </div>
  );
}
