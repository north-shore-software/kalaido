import { ArrowRightIcon, InboxIcon } from "lucide-react";
import { FragmentCard } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
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

export function StreamCard({ f }: StreamCardProps) {
  return (
    <FragmentCard
      type={f.type}
      title={f.title}
      preview={f.preview}
      className="mb-3.5 flex-1 transition-colors group-hover:border-line-strong group-hover:bg-surface-2"
    />
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
