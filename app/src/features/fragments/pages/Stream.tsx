import { PlusIcon } from "@phosphor-icons/react";
import { Fragment as F, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  archiveFragments,
  unarchiveFragments,
} from "@/api/kalaidoscope/fragments";
import type { FragmentTypeOptions } from "@/api/kalaidoscope/types.ts";
import { FragmentDrawer, Mono, Pill } from "@/components/kalaido";
import { PageHeader, PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DayHeader,
  StreamCard,
  StreamEmptyState,
  StreamSkeleton,
} from "@/features/fragments/components/stream-parts";
import { StreamToolbar } from "@/features/fragments/components/stream-toolbar";
import type { LoadedFragment } from "@/features/fragments/types";
import { useCollection } from "@/hooks/use-collection";
import {
  parseColourIds,
  resolveSwatches,
  useColourSwatches,
} from "@/hooks/use-colour-swatches";
import { useLiveCollectionWatching } from "@/hooks/use-live-collection";
import { formatDayGroup, formatTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { streamTransitions } from "./Stream.transitions";

const formatType = (type: string) => {
  return fragmentTypeLabel(type as FragmentTypeOptions);
};

export default function Stream() {
  const { go } = useAppNavigate();
  const { id: selectedId } = useAppParams<"stream">();
  const { records, isLoading, mutate } = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment", "fragment_annotation"],
    {
      sort: "-occurred_at,-created",
      filter: "archived_at = ''",
      fields:
        "id,type,occurred_at,created,title,colour_ids,content:excerpt(300)",
    },
  );
  const swatches = useColourSwatches();
  const colours = useCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });
  const [query, setQuery] = useState("");
  const [colourId, setColourId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [archiving, setArchiving] = useState(false);

  const fragments = useMemo<LoadedFragment[]>(
    () =>
      records.map((f) => {
        const occurredStr = f.occurred_at || f.created;
        return {
          id: f.id,
          type: formatType(f.type),
          title: f.title,
          time: formatTime(occurredStr),
          day: formatDayGroup(occurredStr),
          colours: resolveSwatches(f.colour_ids, swatches),
          colourIds: parseColourIds(f.colour_ids),
          preview: f.content || "",
        };
      }),
    [records, swatches],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !colourId) return fragments;
    return fragments.filter(
      (f) =>
        (!colourId || f.colourIds.includes(colourId)) &&
        (!q ||
          f.title?.toLowerCase().includes(q) ||
          f.preview.toLowerCase().includes(q) ||
          f.type.toLowerCase().includes(q)),
    );
  }, [fragments, query, colourId]);

  const selectedVisible = useMemo(
    () => visible.filter((f) => selected.has(f.id)).map((f) => f.id),
    [visible, selected],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function changeSelecting(on: boolean) {
    setSelecting(on);
    if (!on) setSelected(new Set());
  }

  async function archiveSelected() {
    const ids = selectedVisible;
    if (ids.length === 0) return;
    setArchiving(true);
    const res = await archiveFragments(ids);
    setArchiving(false);
    if (res.isErr()) {
      toast.error("Couldn't archive", { description: res.error.message });
      return;
    }
    setSelected(new Set());
    toast.success(
      ids.length === 1
        ? "Fragment archived"
        : `${ids.length} fragments archived`,
      {
        action: {
          label: "Undo",
          onClick: () => void restore(ids),
        },
      },
    );
    await mutate();
  }

  async function restore(ids: string[]) {
    const res = await unarchiveFragments(ids);
    if (res.isErr()) {
      toast.error("Couldn't restore", { description: res.error.message });
      return;
    }
    await mutate();
  }

  function openOrToggle(id: string) {
    if (selecting) toggleSelected(id);
    else go(streamTransitions.openFragment, { params: { id } });
  }

  let lastDay: string | null = null;

  return (
    <PageLayout>
      <PageHeader
        title="Stream"
        actions={
          fragments.length > 0 ? (
            <Button
              variant="section"
              onClick={() => go(streamTransitions.openImport)}
            >
              <PlusIcon />
              Import
            </Button>
          ) : undefined
        }
      />
      {fragments.length > 0 && (
        <div className="mx-auto w-full max-w-[720px] px-8 pt-4">
          <StreamToolbar
            query={query}
            onQueryChange={setQuery}
            colours={colours.records.map((c) => ({
              id: c.id,
              name: c.name,
              swatch: c.swatch ?? 0,
            }))}
            colourId={colourId}
            onColourChange={setColourId}
            shown={visible.length}
            total={fragments.length}
            selecting={selecting}
            onSelectingChange={changeSelecting}
            selectedCount={selectedVisible.length}
            onSelectAll={() => setSelected(new Set(visible.map((f) => f.id)))}
            onClearSelection={() => setSelected(new Set())}
            onArchive={() => void archiveSelected()}
            archiving={archiving}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-8">
          {isLoading && (
            <div className="mb-5 flex items-center gap-2.5">
              <Pill tone="primary">Loading...</Pill>
            </div>
          )}

          {isLoading ? (
            <StreamSkeleton />
          ) : fragments.length === 0 ? (
            <StreamEmptyState
              onImport={() => go(streamTransitions.openImport)}
            />
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-body-sm text-fg-3">No fragments match.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setColourId(null);
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            visible.map((f, i) => {
              const head = f.day !== lastDay;
              lastDay = f.day;
              const isSelected = selected.has(f.id);
              return (
                <F key={f.id}>
                  {head && <DayHeader day={f.day} first={i === 0} />}
                  {/* biome-ignore lint/a11y/useSemanticElements: cannot be a <button> — child cards render markdown with interactive elements and nesting interactive elements inside a button is invalid. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selecting ? isSelected : undefined}
                    className="group flex w-full min-w-0 cursor-pointer items-start gap-4 text-left"
                    onClick={() => openOrToggle(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openOrToggle(f.id);
                      }
                    }}
                  >
                    <Mono className="w-11 shrink-0 pt-3 text-right text-meta text-fg-4">
                      {f.time}
                    </Mono>
                    <div className="flex w-3.5 shrink-0 flex-col items-center self-stretch">
                      {selecting ? (
                        <Checkbox
                          checked={isSelected}
                          tabIndex={-1}
                          aria-hidden
                          className="pointer-events-none mt-[11px] bg-background"
                        />
                      ) : (
                        <span className="mt-[15px] size-[11px] shrink-0 rounded-none ring-[3px] ring-background bg-section" />
                      )}
                      {i < visible.length - 1 && (
                        <div className="mt-1 min-h-6 w-0.5 flex-1 bg-line" />
                      )}
                    </div>
                    <StreamCard f={f} />
                  </div>
                </F>
              );
            })
          )}
        </div>
      </div>
      <FragmentDrawer
        id={selectedId}
        onClose={() => go(streamTransitions.closeFragment)}
      />
    </PageLayout>
  );
}

export const streamRoute = defineRoute({
  id: "stream",
  path: "/stream/:id?",
  feature: "Fragments",
  requiredScope: ["kalaidoscope"],
  transitions: streamTransitions,
  Component: Stream,
});
