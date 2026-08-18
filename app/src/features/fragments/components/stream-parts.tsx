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
import { ColourSwatch, fragmentTypeIcon, Mono } from "@/components/kalaido";
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
      <span className="text-[11px] font-semibold tracking-[0.1em] text-fg-3 uppercase">
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
          <span className="text-[12.5px] font-semibold text-section-ink">{f.type}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {f.colours.length > 0 ? (
            f.colours
              .map((c, i) => ({ c, key: `${i}-${c}` }))
              .map((s) => <ColourSwatch key={s.key} c={s.c} size={10} />)
          ) : (
            <Mono className="text-[10.5px] text-fg-4">untagged</Mono>
          )}
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
            <Skeleton className="h-3.5 w-16 rounded" />
            <div className="h-px flex-1 bg-line" />
          </div>
          <div className="flex items-start gap-4">
            <Skeleton className="mt-3 h-4 w-11 shrink-0 rounded" />
            <div className="flex flex-1 flex-col gap-2 rounded-lg border border-line bg-card p-3.5">
              <div className="mb-1 flex items-center justify-between">
                <Skeleton className="h-5 w-24 rounded" />
                <Skeleton className="h-3.5 w-12 rounded" />
              </div>
              <Skeleton className="h-1.5 w-full rounded" />
              <Skeleton className="h-1.5 w-[92%] rounded" />
              <Skeleton className="h-1.5 w-[60%] rounded" />
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
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No fragments found</EmptyTitle>
        <EmptyDescription>
          Fragments are the raw, immutable ground truth of your knowledge.
          Import some or paste new text to get started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" className="gap-1.5 shadow-sm" onClick={onImport}>
          Import fragments
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </EmptyContent>
    </Empty>
  );
}
