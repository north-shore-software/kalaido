import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import type { SnapshotEdit } from "@/api/kalaidoscope/projections";
import { StatusPill } from "@/components/kalaido";

export interface EditsStatusPillProps {
  edits: SnapshotEdit[];
  onNext?: () => void;
  onPrev?: () => void;
  canNext?: boolean;
  canPrev?: boolean;
}

export function EditsStatusPill({
  edits,
  onNext,
  onPrev,
  canNext,
  canPrev,
}: EditsStatusPillProps) {
  if (edits.length === 0) return null;
  const proposedCount = edits.filter((e) => e.status === "proposed").length;
  const approvedCount = edits.filter((e) => e.status === "approved").length;

  if (proposedCount === 0) {
    return (
      <StatusPill kind="stable">
        {approvedCount} of {edits.length} approved
      </StatusPill>
    );
  }

  return (
    <StatusPill kind="yellow" className="gap-1.5 pr-0.5">
      <button
        type="button"
        disabled={!canNext && !canPrev}
        onClick={onNext}
        className="cursor-pointer hover:underline disabled:cursor-default disabled:no-underline"
      >
        {proposedCount} unresolved {proposedCount === 1 ? "edit" : "edits"}
      </button>
      {(onNext || onPrev) && (
        <span className="inline-flex items-center gap-0.5">
          <button
            type="button"
            disabled={!canPrev}
            onClick={(e) => {
              e.stopPropagation();
              onPrev?.();
            }}
            title="Previous edit (k)"
            aria-label="Previous edit"
            className="inline-flex size-4 items-center justify-center rounded-none hover:bg-black/10 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <CaretUpIcon className="size-2.5" />
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={(e) => {
              e.stopPropagation();
              onNext?.();
            }}
            title="Next edit (j)"
            aria-label="Next edit"
            className="inline-flex size-4 items-center justify-center rounded-none hover:bg-black/10 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <CaretDownIcon className="size-2.5" />
          </button>
        </span>
      )}
    </StatusPill>
  );
}
