import { useMemo } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ColourSwatch, fragmentTypeIcon, Mono } from "@/components/kalaido";
import { useLiveCollectionWatching } from "@/hooks/use-live-collection";
import { formatShortDateTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels.ts";
import type { FragmentTypeOptions } from "@/api/kalaidoscope/types.ts";

function parseColours(raw: unknown): number[] {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/**
 * Right-side drawer showing a single fragment in full. Driven by `id`: open
 * whenever an id is selected, closing calls `onClose` (the stream navigates
 * back to `/stream`). Reuses the `view_stream` row shape the list already
 * caches, so it usually renders instantly from cache.
 */
export function FragmentDrawer({
  id,
  onClose,
}: {
  id?: string;
  onClose: () => void;
}) {
  const { records, isLoading } = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment"],
    { filter: id ? `id="${id}"` : undefined, enabled: !!id },
  );

  const fragment = records[0];
  const colours = useMemo(
    () => (fragment ? parseColours(fragment.colours) : []),
    [fragment],
  );

  const Icon = fragment ? fragmentTypeIcon(fragment.type) : null;
  const occurredStr = fragment?.source_time || fragment?.created;

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        {isLoading && !fragment ? (
          <div className="flex flex-col gap-3 p-6">
            <Skeleton className="h-6 w-40 rounded" />
            <Skeleton className="h-3.5 w-24 rounded" />
            <div className="mt-3 flex flex-col gap-2">
              <Skeleton className="h-2 w-full rounded" />
              <Skeleton className="h-2 w-[94%] rounded" />
              <Skeleton className="h-2 w-[88%] rounded" />
              <Skeleton className="h-2 w-[70%] rounded" />
            </div>
          </div>
        ) : !fragment ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
            <SheetTitle className="text-sm">Fragment not found</SheetTitle>
            <SheetDescription>
              This fragment may have been removed.
            </SheetDescription>
          </div>
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-line p-6">
              <div className="flex items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2">
                  {Icon && <Icon className="size-3.5 text-fg-3" />}
                </span>
                <SheetTitle className="text-[13px] font-semibold">
                  {fragmentTypeLabel(fragment.type as FragmentTypeOptions)}
                </SheetTitle>
              </div>
              <div className="flex items-center gap-3">
                <SheetDescription className="font-mono text-[11.5px] text-fg-4">
                  {occurredStr ? formatShortDateTime(occurredStr) : "Fragment"}
                </SheetDescription>
                {colours.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    {colours
                      .map((c, i) => ({ c, key: `${i}-${c}` }))
                      .map((s) => (
                        <ColourSwatch key={s.key} c={s.c} size={10} />
                      ))}
                  </div>
                ) : (
                  <Mono className="text-[10.5px] text-fg-4">untagged</Mono>
                )}
              </div>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <Mono className="block px-6 py-5 text-xs leading-relaxed whitespace-pre-wrap text-fg-2">
                {fragment.content}
              </Mono>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
