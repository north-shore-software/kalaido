import { ArrowRightIcon, InboxIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { fragmentTypeIcon } from "@/components/kalaido";
import { cn } from "@/lib/css-utils";
import type { LoadedFragment } from "../types";

export interface DayHeaderProps {
  day: string;
  first: boolean;
}

export function DayHeader({ day, first }: DayHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        first ? "mb-3.5" : "mt-5 mb-3.5",
      )}
    >
      <span className="text-label font-semibold tracking-[0.14em] text-fg-3 uppercase">
        {day}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

export interface StreamCardProps {
  f: LoadedFragment;
}

/** Stream card — the timeline variant (colours in the header, no timestamp). */
export function StreamCard({ f }: StreamCardProps) {
  const Icon = fragmentTypeIcon(f.type);
  return (
    <div className="mb-3.5 flex-1 rounded-none border border-line border-l-2 border-l-section-edge bg-card p-3.5 transition-colors hover:border-line-strong hover:border-l-2 hover:border-l-section hover:bg-section-wash">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-none bg-surface-2">
            <Icon className="size-3.5 text-section-ink" />
          </span>
          <span className="text-body-sm font-semibold text-section-ink">
            {f.type}
          </span>
        </div>
      </div>
      <p className="line-clamp-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-1">
        {f.preview}
      </p>
    </div>
  );
}

export function StreamSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="mt-4 mb-2 flex items-center gap-3">
            <Skeleton className="h-3.5 w-16 rounded-none" />
            <div className="h-px flex-1 bg-line" />
          </div>
          <div className="flex items-start gap-4">
            <Skeleton className="mt-3 h-4 w-11 shrink-0 rounded-none" />
            <div className="flex flex-1 flex-col gap-2 rounded-none border border-line bg-card p-3.5">
              <div className="mb-1 flex items-center justify-between">
                <Skeleton className="h-5 w-24 rounded-none" />
                <Skeleton className="h-3.5 w-12 rounded-none" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-none" />
              <Skeleton className="h-1.5 w-[92%] rounded-none" />
              <Skeleton className="h-1.5 w-[60%] rounded-none" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface StreamEmptyStateProps {
  onImport: () => void;
}

export function StreamEmptyState({ onImport }: StreamEmptyStateProps) {
  return (
    <Empty className="flex-1 justify-center pb-28">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="rounded-none bg-section-wash text-section-ink"
        >
          <InboxIcon className="size-5 text-section-ink" />
        </EmptyMedia>
        <EmptyTitle>No fragments found</EmptyTitle>
        <EmptyDescription>
          Fragments are the raw, immutable ground truth of your knowledge.
          Import some or paste new text to get started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="section" onClick={onImport}>
          Import fragments
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </EmptyContent>
    </Empty>
  );
}
