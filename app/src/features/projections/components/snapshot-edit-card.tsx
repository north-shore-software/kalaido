import { CheckIcon, ChatCircleDotsIcon, XIcon } from "@phosphor-icons/react";
import type {
  SnapshotEdit,
  SnapshotEditStatus,
} from "@/api/kalaidoscope/projections";
import { EditDiffBoxes, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";

export interface SnapshotEditCardProps {
  edit: SnapshotEdit;
  onStatusChange: (status: SnapshotEditStatus) => void;
  onRefine?: (edit: SnapshotEdit) => void;
  disabled?: boolean;
  /** Holds only Refine: deciding the proposal stays open. */
  refineDisabled?: boolean;
  className?: string;
  isActive?: boolean;
}

export function SnapshotEditCard({
  edit,
  onStatusChange,
  onRefine,
  disabled,
  refineDisabled,
  className,
  isActive,
}: SnapshotEditCardProps) {
  return (
    <div
      id={`edit-card-${edit.id}`}
      className={cn(
        "my-3 rounded-none border border-magenta/40 bg-surface-1 shadow-sm transition-colors",
        isActive && "border-magenta ring-1 ring-magenta",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 bg-surface-2/60 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
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
          <StatusPill kind="yellow">{edit.status}</StatusPill>
        </div>

        <div className="flex items-center gap-1.5">
          {onRefine && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || refineDisabled}
              onClick={() => onRefine(edit)}
              className="h-6 gap-1 px-2 text-xs"
            >
              <ChatCircleDotsIcon className="size-3" />
              Refine
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onStatusChange("rejected")}
            className="h-6 gap-1 px-2 text-xs text-critical hover:bg-critical-wash/20"
          >
            <XIcon className="size-3" />
            Reject
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={disabled}
            onClick={() => onStatusChange("approved")}
            className="h-6 gap-1 bg-stable px-2 text-xs text-white hover:bg-stable/90"
          >
            <CheckIcon className="size-3" />
            Accept
          </Button>
        </div>
      </div>

      <div className="p-3">
        <EditDiffBoxes
          before={edit.contentBefore}
          after={edit.contentAfter}
          collapseBefore
        />
      </div>
    </div>
  );
}
