import type { KalaidoscopeMeta } from "@kalaido/platform";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kalaido/primitives/shadcn/dropdown-menu";
import {
  CaretDownIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
} from "@phosphor-icons/react";

export interface CompactExploreHeaderProps {
  activeScope: KalaidoscopeMeta | null;
  cloudScopes: readonly KalaidoscopeMeta[];
  switchingScope: boolean;
  historyOpen: boolean;
  bookmarkedCount: number;
  allSaved: boolean;
  saving: boolean;
  busy: boolean;
  onSelectScope: (id: string) => void;
  onSignOut: () => void;
  onNew: () => void;
  onToggleHistory: () => void;
  onSave: () => void;
}

function saveButtonLabel({
  saving,
  allSaved,
  bookmarkedCount,
}: {
  saving: boolean;
  allSaved: boolean;
  bookmarkedCount: number;
}): string {
  if (saving) return "Saving…";
  if (allSaved) return "Saved";
  return bookmarkedCount > 0 ? `Save ${bookmarkedCount}` : "Save";
}

export function CompactExploreHeader({
  activeScope,
  cloudScopes,
  switchingScope,
  historyOpen,
  bookmarkedCount,
  allSaved,
  saving,
  busy,
  onSelectScope,
  onSignOut,
  onNew,
  onToggleHistory,
  onSave,
}: CompactExploreHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 items-center gap-1.5 text-item font-medium text-foreground outline-none">
          <span className="truncate">
            {activeScope?.displayName ?? "Explore"}
          </span>
          <CaretDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="w-64">
          {cloudScopes.map((ws) => {
            const isActive = ws.id === activeScope?.id;
            return (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => onSelectScope(ws.id)}
                disabled={switchingScope}
                className="cursor-pointer justify-between gap-2 px-3 py-2.5 text-item normal-case tracking-normal"
              >
                <span className="truncate font-medium">{ws.displayName}</span>
                {isActive && <CheckIcon className="size-4 shrink-0" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onSignOut}
            disabled={switchingScope}
            className="cursor-pointer px-3 py-2.5 text-item normal-case tracking-normal"
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          onClick={onNew}
        >
          <NotePencilIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="History"
          aria-pressed={historyOpen}
          onClick={onToggleHistory}
        >
          <ClockCounterClockwiseIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="section"
          size="sm"
          onClick={onSave}
          disabled={busy || bookmarkedCount === 0 || allSaved}
        >
          {saveButtonLabel({ saving, allSaved, bookmarkedCount })}
        </Button>
      </div>
    </header>
  );
}
