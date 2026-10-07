import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { updateColour } from "@/api/kalaidoscope/colours";
import {
  archiveFragment,
  renameFragment,
  unarchiveFragment,
} from "@/api/kalaidoscope/fragments";
import type {
  ColourFragmentMatchTypeOptions,
  FragmentTypeOptions,
} from "@/api/kalaidoscope/types.ts";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
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
import { formatShortDateTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels.ts";
import { ColourSwatch } from "./colour";
import { ItemPicker } from "./context-picker/item-picker";
import { fragmentTypeIcon } from "./icons";
import { MarkdownContent } from "./markdown-content";
import { StatusPill } from "./status-pill";
import { Mono } from "./text";

export function FragmentDrawer({
  id,
  onClose,
}: {
  id?: string;
  onClose: () => void;
}) {
  const { records, isLoading, mutate } = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment"],
    { filter: id ? `id="${id}"` : undefined, enabled: !!id },
  );
  const [archiving, setArchiving] = useState(false);

  const fragment = records[0];
  const Icon = fragment ? fragmentTypeIcon(fragment.type) : null;
  const occurredStr = fragment?.occurred_at || fragment?.created;
  const archived = !!fragment?.archived_at;

  async function toggleArchive() {
    if (!fragment) return;
    setArchiving(true);
    const res = archived
      ? await unarchiveFragment(fragment.id)
      : await archiveFragment(fragment.id);
    setArchiving(false);
    if (res.isErr()) {
      toast.error(archived ? "Couldn't restore" : "Couldn't archive", {
        description: res.error.message,
      });
      return;
    }
    toast.success(archived ? "Fragment restored" : "Fragment archived");
    await mutate();
  }

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
            <SheetTitle>Fragment not found</SheetTitle>
            <SheetDescription className="text-body-sm text-fg-3">
              This fragment may have been removed.
            </SheetDescription>
          </div>
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-line p-6 md:p-8">
              <div className="flex items-center gap-2.5 pr-8">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
                  {Icon && <Icon className="size-3.5 text-fg-3" />}
                </span>
                <EditableTitle
                  key={fragment.id}
                  fragmentId={fragment.id}
                  title={fragment.title ?? ""}
                  fallback={fragmentTypeLabel(
                    fragment.type as FragmentTypeOptions,
                  )}
                  onSaved={() => void mutate()}
                />
                {archived && <StatusPill kind="neutral">archived</StatusPill>}
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={archiving}
                  onClick={() => void toggleArchive()}
                >
                  {archived ? <ArrowCounterClockwiseIcon /> : <ArchiveIcon />}
                  {archived ? "Restore" : "Archive"}
                </Button>
              </div>
              <SheetDescription className="font-mono text-meta text-fg-4">
                {fragmentTypeLabel(fragment.type as FragmentTypeOptions)}
                {occurredStr && ` · ${formatShortDateTime(occurredStr)}`}
              </SheetDescription>
              <FragmentColours fragmentId={fragment.id} />
              <FragmentSummary fragmentId={fragment.id} />
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

/**
 * The drawer's heading: the fragment's title, click to rename. Enter or blur
 * saves, Escape cancels; an empty name clears the user's title so the stream
 * falls back to the annotation's.
 */
function EditableTitle({
  fragmentId,
  title,
  fallback,
  onSaved,
}: {
  fragmentId: string;
  title: string;
  fallback: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    setDraft(title);
    cancelled.current = false;
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim();
    if (next === title.trim()) return;
    const res = await renameFragment(fragmentId, next);
    if (res.isErr()) {
      toast.error("Couldn't rename", { description: res.error.message });
      return;
    }
    onSaved();
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        placeholder={fallback}
        aria-label="Fragment title"
        className="h-7 min-w-0 flex-1"
      />
    );
  }

  return (
    <SheetTitle
      role="button"
      tabIndex={0}
      title="Click to rename"
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          start();
        }
      }}
      className="min-w-0 cursor-text truncate hover:text-fg-2"
    >
      {title || fallback}
    </SheetTitle>
  );
}

type Link = { colour_id: string; match_type: ColourFragmentMatchTypeOptions };

const MATCH_LABEL: Record<ColourFragmentMatchTypeOptions, string> = {
  manual_positive: "pinned",
  manual_negative: "excluded",
  ingest: "imported",
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
    fields: "id,name,swatch",
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
              <ColourSwatch c={c.swatch ?? 0} size={9} />
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
            swatch: c.swatch,
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

function FragmentSummary({ fragmentId }: { fragmentId: string }) {
  const { records } = useLiveCollectionWatching(
    "fragment_annotation",
    ["fragment_annotation"],
    {
      filter: `fragment_id="${fragmentId}"`,
      fields: "id,summary",
    },
  );
  const summary = records[0]?.summary;
  if (!summary) return null;

  return (
    <Collapsible defaultOpen className="flex flex-col gap-1.5 pt-1">
      <CollapsibleTrigger className="group flex w-fit items-center gap-1 font-mono text-meta text-fg-4 hover:text-fg-2 cursor-pointer">
        <CaretRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        <span>Summary</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-body-sm text-fg-3 leading-relaxed border-l-2 border-line pl-2.5">
          {summary}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
