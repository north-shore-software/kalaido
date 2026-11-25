import { Button } from "@kalaido/primitives/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kalaido/primitives/shadcn/dropdown-menu";
import { DotsThreeIcon, GitForkIcon, TrashIcon } from "@phosphor-icons/react";

export interface ProjectionDetailActionsProps {
  onFork: (mode: "refine" | "orthogonal") => void;
  onRequestDelete: () => void;
}

export function ProjectionDetailActions({
  onFork,
  onRequestDelete,
}: ProjectionDetailActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="outline">
              <GitForkIcon />
              Branch
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onClick={() => onFork("refine")}>
            <div className="flex flex-col gap-0.5">
              <span>Refine into next stage</span>
              <span className="text-meta text-fg-3">
                Reads this projection's output
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onFork("orthogonal")}>
            <div className="flex flex-col gap-0.5">
              <span>Alternate view</span>
              <span className="text-meta text-fg-3">
                Reads this projection's inputs
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="ghost" aria-label="More actions">
              <DotsThreeIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={onRequestDelete}>
            <TrashIcon />
            Delete projection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
