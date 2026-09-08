import { FolderInputIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ImportNotesCardProps {
  hasFragments: boolean;
  onClick: () => void;
}

export function ImportNotesCard({
  hasFragments,
  onClick,
}: ImportNotesCardProps) {
  if (!hasFragments) {
    return (
      <div
        onClick={onClick}
        className="group flex w-74 cursor-pointer flex-col items-center gap-4 rounded-none border border-dashed border-magenta-edge bg-magenta-wash px-5 py-10 text-center transition-colors hover:border-magenta hover:bg-surface-2"
      >
        <div className="flex size-12 shrink-0 items-center justify-center rounded-none border border-magenta-edge bg-surface-1 text-magenta transition-colors group-hover:border-magenta group-hover:bg-magenta-wash">
          <FolderInputIcon className="size-6 text-magenta transition-colors" />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          <span className="text-card-title font-bold text-fg-1">
            Import your notes
          </span>
          <span className="text-body-sm text-fg-3">
            Bring in documents, notes, or an email archive to map and organise
            them.
          </span>
        </div>
        <Button
          variant="commit"
          className="mt-auto"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          Import
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3.5 rounded-none border border-dashed border-line-strong px-4 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-surface-2"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-none border border-line bg-surface-1 text-fg-3 transition-colors group-hover:text-fg-1">
        <FolderInputIcon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-row font-semibold text-fg-1">
          Import more notes
        </span>
        <span className="truncate text-meta text-fg-3">
          Add notes, papers, or archives to expand your knowledge base.
        </span>
      </div>
    </button>
  );
}
