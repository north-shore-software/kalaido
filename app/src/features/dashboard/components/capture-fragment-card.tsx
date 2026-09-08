import { NotebookPenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CaptureFragmentCardProps {
  hasFragments?: boolean;
  onClick: () => void;
}

export function CaptureFragmentCard({
  hasFragments,
  onClick,
}: CaptureFragmentCardProps) {
  if (hasFragments) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3.5 rounded-none border border-dashed border-line-strong px-4 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-surface-2"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-none border border-line bg-surface-1 text-fg-3 transition-colors group-hover:text-fg-1">
          <NotebookPenIcon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-row font-semibold text-fg-1">
            Capture a new fragment
          </span>
          <span className="truncate text-meta text-fg-3">
            Write or paste raw text, thoughts, or ideas directly.
          </span>
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={onClick}
      className="group flex w-74 cursor-pointer flex-col items-center gap-4 rounded-none border border-dashed border-cyan-edge bg-cyan-veil px-5 py-10 text-center transition-colors hover:border-cyan hover:bg-surface-2"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-none border border-cyan-edge bg-surface-1 text-cyan transition-colors group-hover:border-cyan group-hover:bg-cyan-wash">
        <NotebookPenIcon className="size-6 text-cyan transition-colors" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5">
        <span className="text-card-title font-bold text-fg-1">
          Capture a new fragment
        </span>
        <span className="text-body-sm text-fg-3">
          Write or paste raw text, thoughts, or ideas directly into your
          workspace.
        </span>
      </div>
      <Button
        className="mt-auto border-0 bg-cyan font-bold text-cyan-foreground clip-chamfer hover:opacity-[0.86]"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        Capture
      </Button>
    </div>
  );
}
