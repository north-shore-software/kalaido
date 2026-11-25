import { updateColour } from "@kalaido/client/kalaidoscope/colours";
import {
  archiveFragment,
  renameFragment,
  unarchiveFragment,
} from "@kalaido/client/kalaidoscope/fragments";
import type {
  ColourFragmentMatchTypeOptions,
  FragmentTypeOptions,
} from "@kalaido/client/kalaidoscope/types";
import { fragmentTypeLabel } from "@kalaido/client/lib/labels";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import {
  useLiveCollection,
  useLiveCollectionWatching,
} from "@kalaido/hooks/use-live-collection";
import { ColourSwatch } from "@kalaido/primitives/kalaido/colour";
import { Mono } from "@kalaido/primitives/kalaido/text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@kalaido/primitives/shadcn/collapsible";
import { Input } from "@kalaido/primitives/shadcn/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@kalaido/primitives/shadcn/sheet";
import { useExternalWrite } from "@kalaido/state/live";
import { CaretRightIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ItemPicker } from "./context-picker/item-picker";
import {
  FragmentDrawerBody,
  FragmentDrawerLoading,
  FragmentDrawerMissing,
} from "./fragment-drawer/fragment-drawer-body";

export function FragmentDrawer({
  id,
  onClose,
}: {
  id?: string;
  onClose: () => void;
}) {
  const client = useKalaidoscopeClient();
  const { records, isLoading } = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment"],
    { filter: id ? `id="${id}"` : undefined, enabled: !!id },
  );

  const archiveWrite = useExternalWrite<
    { fragmentId: string; archived: boolean },
    void
  >({
    execute: ({ fragmentId, archived: isArchived }) =>
      isArchived ? unarchiveFragment(fragmentId) : archiveFragment(fragmentId),
    concurrency: "ignore",
    invalidates: () => [kalaidoscopeCollectionTag(client.baseURL, "fragment")],
  });

  const fragment = records[0];
  const archived = !!fragment?.archived_at;

  async function toggleArchive() {
    if (!fragment) return;
    const outcome = await archiveWrite.run({
      fragmentId: fragment.id,
      archived,
    });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error(archived ? "Couldn't restore" : "Couldn't archive", {
        description: outcome.error.message,
      });
      return;
    }
    toast.success(archived ? "Fragment restored" : "Fragment archived");
  }

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[60vw] data-[side=right]:sm:max-w-[60vw]"
      >
        {isLoading && !fragment ? (
          <FragmentDrawerLoading />
        ) : !fragment ? (
          <FragmentDrawerMissing />
        ) : (
          <FragmentDrawerBody
            type={fragment.type}
            occurredStr={fragment.occurred_at || fragment.created}
            content={fragment.content}
            archived={archived}
            archivePending={archiveWrite.isPending}
            onToggleArchive={() => void toggleArchive()}
            titleSlot={
              <EditableTitle
                key={fragment.id}
                fragmentId={fragment.id}
                title={fragment.title ?? ""}
                fallback={fragmentTypeLabel(
                  fragment.type as FragmentTypeOptions,
                )}
              />
            }
            metaSlots={
              <>
                <FragmentColours fragmentId={fragment.id} />
                <FragmentSummary fragmentId={fragment.id} />
              </>
            }
          />
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
}: {
  fragmentId: string;
  title: string;
  fallback: string;
}) {
  const client = useKalaidoscopeClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  const renameWrite = useExternalWrite<string, void>({
    execute: (next) => renameFragment(fragmentId, next),
    concurrency: "ignore",
    invalidates: () => [kalaidoscopeCollectionTag(client.baseURL, "fragment")],
  });

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
    const outcome = await renameWrite.run(next);
    if (outcome.status === "error") {
      toast.error("Couldn't rename", { description: outcome.error.message });
    }
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
  const client = useKalaidoscopeClient();
  const links = useLiveCollectionWatching(
    "colour_fragment",
    ["colour_fragment"],
    {
      filter: `fragment_id="${fragmentId}"`,
      fields: "id,colour_id,match_type",
    },
  );
  const colours = useLiveCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });
  const [picking, setPicking] = useState(false);

  const colourWrite = useExternalWrite<
    {
      colourId: string;
      input: Parameters<typeof updateColour>[1];
    },
    void
  >({
    execute: async ({ colourId, input }) =>
      (await updateColour(colourId, input)).map(() => undefined),
    concurrency: "allow",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "colour_fragment"),
    ],
  });

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
    const outcome = await colourWrite.run({ colourId, input });
    if (outcome.status === "error") {
      toast.error("Failed to update colour", {
        description: outcome.error.message,
      });
    }
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
