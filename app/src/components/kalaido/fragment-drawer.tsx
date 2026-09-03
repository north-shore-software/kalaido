import { PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { updateColour } from "@/api/kalaidoscope/colours";
import type {
  ColourFragmentMatchTypeOptions,
  FragmentTypeOptions,
} from "@/api/kalaidoscope/types.ts";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollection } from "@/hooks/use-collection";
import { useLiveCollectionWatching } from "@/hooks/use-live-collection";
import { swatchIndex } from "@/lib/colors";
import { formatShortDateTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels.ts";
import { ColourSwatch } from "./colour";
import { ItemPicker } from "./context-picker/item-picker";
import { fragmentTypeIcon } from "./icons";
import { MarkdownContent } from "./markdown-content";
import { Mono } from "./text";

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
  const Icon = fragment ? fragmentTypeIcon(fragment.type) : null;
  const occurredStr = fragment?.source_time || fragment?.created;

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[60vw] data-[side=right]:sm:max-w-[60vw]"
      >
        {isLoading && !fragment ? (
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
        ) : !fragment ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
            <SheetTitle className="text-body-sm">Fragment not found</SheetTitle>
            <SheetDescription className="text-body-sm text-fg-3">
              This fragment may have been removed.
            </SheetDescription>
          </div>
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-line p-6 md:p-8">
              <div className="flex items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
                  {Icon && <Icon className="size-3.5 text-fg-3" />}
                </span>
                <SheetTitle className="text-item font-semibold">
                  {fragmentTypeLabel(fragment.type as FragmentTypeOptions)}
                </SheetTitle>
              </div>
              <SheetDescription className="font-mono text-meta text-fg-4">
                {occurredStr ? formatShortDateTime(occurredStr) : "Fragment"}
              </SheetDescription>
              <FragmentColours fragmentId={fragment.id} />
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-6 py-5 md:px-8 md:py-6">
                <MarkdownContent
                  variant="document"
                  content={fragment.content}
                />
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

type Link = { colour_id: string; match_type: ColourFragmentMatchTypeOptions };

const MATCH_LABEL: Record<ColourFragmentMatchTypeOptions, string> = {
  manual_positive: "pinned",
  manual_negative: "excluded",
  thing: "map",
  prompt: "matched",
};

function FragmentColours({ fragmentId }: { fragmentId: string }) {
  const links = useLiveCollectionWatching(
    "colour_fragment",
    ["colour_fragment"],
    {
      filter: `fragment_id="${fragmentId}"`,
      fields: "id,colour_id,match_type",
    },
  );
  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,colour_value",
  });
  const [picking, setPicking] = useState(false);

  const linkByColour = useMemo(() => {
    const m = new Map<string, Link>();
    for (const l of links.records as unknown as Link[]) m.set(l.colour_id, l);
    return m;
  }, [links.records]);
  const memberIds = useMemo(() => {
    const s = new Set<string>();
    for (const [cid, l] of linkByColour)
      if (l.match_type !== "manual_negative") s.add(cid);
    return s;
  }, [linkByColour]);

  async function change(colourId: string, remove: boolean) {
    const link = linkByColour.get(colourId);
    const input = remove
      ? link?.match_type === "manual_positive"
        ? { clearExamples: [fragmentId] }
        : { negativeExamples: [fragmentId] }
      : { positiveExamples: [fragmentId] };
    const res = await updateColour(colourId, input);
    if (res.isErr()) {
      toast.error("Failed to update colour", {
        description: res.error.message,
      });
      return;
    }
    await links.mutate();
  }

  const chips = colours.records.filter((c) => memberIds.has(c.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const link = linkByColour.get(c.id);
          return (
            <span
              key={c.id}
              className="group flex items-center gap-1.5 border border-line px-1.5 py-0.5 text-body-sm text-fg-2"
            >
              <ColourSwatch
                c={swatchIndex(c.id)}
                value={c.colour_value || undefined}
                size={9}
              />
              {c.name || "Untitled colour"}
              {link && (
                <Mono className="text-meta text-fg-4">
                  {MATCH_LABEL[link.match_type]}
                </Mono>
              )}
              <button
                type="button"
                title={
                  link?.match_type === "manual_positive"
                    ? "Unpin"
                    : "Exclude from this colour"
                }
                onClick={() => void change(c.id, true)}
                className="text-fg-4 hover:text-critical-ink"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          );
        })}
        {chips.length === 0 && !picking && (
          <Mono className="text-meta text-fg-4">untagged</Mono>
        )}
        <button
          type="button"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
          className="flex items-center gap-1 border border-dashed border-line-strong px-1.5 py-0.5 text-body-sm text-fg-3 hover:text-fg-1"
        >
          <PlusIcon className="size-3" />
          colour
        </button>
      </div>
      {picking && (
        <ItemPicker
          kindLabel="Colour"
          tint="section"
          options={colours.records.map((c) => ({
            id: c.id,
            label: c.name || "Untitled colour",
            value: c.colour_value || undefined,
          }))}
          selectedIds={memberIds}
          loading={colours.isLoading}
          onPick={(o) => void change(o.id, memberIds.has(o.id))}
          onClose={() => setPicking(false)}
          emptyCopy="No colours yet. Create one on the Colours page."
        />
      )}
    </div>
  );
}
