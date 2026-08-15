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
        <div className="flex items-center border-b border-line px-5 py-2.5">
          <StatusPill kind="magenta" dot>
            current
          </StatusPill>
        </div>
        <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-6 py-5 text-[13px] leading-relaxed">
          {currentContent || (
            <span className="text-fg-2">No live snapshot yet.</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b border-line bg-magenta-wash px-5 py-2.5">
          <StatusPill kind="magenta">
            {refining ? "refined" : "pending"}
          </StatusPill>
        </div>
        <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-6 py-5 text-[13px] leading-relaxed">
          {pendingContent || "(empty candidate)"}
        </div>
      </div>
    </div>
  );
}
