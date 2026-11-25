import type { FragmentTypeOptions } from "@kalaido/client/kalaidoscope/types";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { fragmentTypeLabel } from "@kalaido/client/lib/labels";
import { fragmentTypeIcon } from "@kalaido/primitives/kalaido/icons";
import { StatusPill } from "@kalaido/primitives/kalaido/status-pill";
import { Button } from "@kalaido/primitives/shadcn/button";
import { ScrollArea } from "@kalaido/primitives/shadcn/scroll-area";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@kalaido/primitives/shadcn/sheet";
import { Skeleton } from "@kalaido/primitives/shadcn/skeleton";
import { ArchiveIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { MarkdownContent } from "../markdown-content";

export function FragmentDrawerLoading() {
  return (
    <div className="flex flex-col gap-3 p-6 md:p-8">
      <Skeleton className="h-6 w-40 rounded-none" />
      <Skeleton className="h-3.5 w-24 rounded-none" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-2 w-full rounded-none" />
        <Skeleton className="h-2 w-[94%] rounded-none" />
        <Skeleton className="h-2 w-[88%] rounded-none" />
        <Skeleton className="h-2 w-[70%] rounded-none" />
      </div>
    </div>
  );
}

export function FragmentDrawerMissing() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
      <SheetTitle>Fragment not found</SheetTitle>
      <SheetDescription className="text-body-sm text-fg-3">
        This fragment may have been removed.
      </SheetDescription>
    </div>
  );
}

export function FragmentDrawerBody({
  type,
  occurredStr,
  content,
  archived,
  archivePending,
  onToggleArchive,
  titleSlot,
  metaSlots,
}: {
  type: string;
  occurredStr?: string;
  content: string;
  archived: boolean;
  archivePending: boolean;
  onToggleArchive: () => void;
  titleSlot: ReactNode;
  metaSlots: ReactNode;
}) {
  const Icon = fragmentTypeIcon(type);
  const typeLabel = fragmentTypeLabel(type as FragmentTypeOptions);
  return (
    <>
      <SheetHeader className="gap-2 border-b border-line p-6 md:p-8">
        <div className="flex items-center gap-2.5 pr-8">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
            <Icon className="size-3.5 text-fg-3" />
          </span>
          {titleSlot}
          {archived && <StatusPill kind="neutral">archived</StatusPill>}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={archivePending}
            onClick={onToggleArchive}
          >
            {archived ? <ArrowCounterClockwiseIcon /> : <ArchiveIcon />}
            {archived ? "Restore" : "Archive"}
          </Button>
        </div>
        <SheetDescription className="font-mono text-meta text-fg-4">
          {typeLabel}
          {occurredStr && ` · ${formatShortDateTime(occurredStr)}`}
        </SheetDescription>
        {metaSlots}
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-5 md:px-8 md:py-6">
          <MarkdownContent variant="document" content={content} />
        </div>
      </ScrollArea>
    </>
  );
}
