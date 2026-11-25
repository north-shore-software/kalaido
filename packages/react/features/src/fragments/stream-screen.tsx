import {
  archiveFragments,
  unarchiveFragments,
} from "@kalaido/client/kalaidoscope/fragments";
import type { FragmentTypeOptions } from "@kalaido/client/kalaidoscope/types";
import {
  formatDayGroup,
  formatShortDateTime,
  formatTime,
} from "@kalaido/client/lib/datetime";
import { fragmentTypeLabel } from "@kalaido/client/lib/labels";
import { FragmentDrawer, PageHeader } from "@kalaido/components";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import {
  parseColourIds,
  resolveSwatches,
  useColourSwatches,
} from "@kalaido/hooks/use-colour-swatches";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import {
  useLiveCollection,
  useLiveCollectionWatching,
} from "@kalaido/hooks/use-live-collection";
import { Mono, Pill } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Checkbox } from "@kalaido/primitives/shadcn/checkbox";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { PlusIcon } from "@phosphor-icons/react";
import { Fragment as F, useMemo } from "react";
import { toast } from "sonner";
import {
  DayHeader,
  StreamCard,
  StreamEmptyState,
  StreamSkeleton,
} from "./components/stream-parts";
import { StreamToolbar } from "./components/stream-toolbar";
import type { LoadedFragment } from "./types";

const formatType = (type: string) => {
  return fragmentTypeLabel(type as FragmentTypeOptions);
};

const importLabel = (files: string[], created: string) => {
  const name = files[0]?.replace(/_[a-z0-9]{10}(\.[^.]*)?$/, "$1") ?? "Import";
  const more = files.length > 1 ? ` +${files.length - 1}` : "";
  return `${name}${more} · ${formatShortDateTime(created)}`;
};

interface StreamWorkflowState {
  query: string;
  colourId: string | null;
  importId: string | null;
  selecting: boolean;
  selectedIds: string[];
}

type StreamWorkflowEvent =
  | { readonly type: "setQuery"; readonly query: string }
  | { readonly type: "setColourId"; readonly colourId: string | null }
  | { readonly type: "setImportId"; readonly importId: string | null }
  | { readonly type: "clearFilters" }
  | { readonly type: "setSelecting"; readonly selecting: boolean }
  | { readonly type: "toggleSelected"; readonly id: string }
  | { readonly type: "setSelectedIds"; readonly ids: string[] }
  | { readonly type: "clearSelection" };

export interface StreamScreenProps {
  selectedId?: string;
  onOpenFragment: (id: string) => void;
  onCloseFragment: () => void;
  onOpenImport: () => void;
}

export function StreamScreen({
  selectedId,
  onOpenFragment,
  onCloseFragment,
  onOpenImport,
}: StreamScreenProps) {
  const client = useKalaidoscopeClient();
  const { records, isLoading } = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment", "fragment_annotation"],
    {
      sort: "-occurred_at,-created",
      filter: "archived_at = ''",
      fields:
        "id,type,occurred_at,created,title,colour_ids,ingest_ref,content:excerpt(300)",
    },
  );
  const swatches = useColourSwatches();
  const colours = useLiveCollection("colour", {
    sort: "-created",
    fields: "id,name,swatch",
  });
  const ingests = useLiveCollection("ingest", {
    sort: "-created",
    filter: "status = 'done' && ingested > 0",
    fields: "id,file,created",
  });
  const imports = useMemo(
    () =>
      ingests.records.map((i) => ({
        id: i.id,
        label: importLabel(i.file ?? [], i.created),
      })),
    [ingests.records],
  );

  const handlers: ScopeHandlers<StreamWorkflowState, StreamWorkflowEvent> = {
    setQuery: (s, e) => {
      s.query = e.query;
    },
    setColourId: (s, e) => {
      s.colourId = e.colourId;
    },
    setImportId: (s, e) => {
      s.importId = e.importId;
    },
    clearFilters: (s) => {
      s.query = "";
      s.colourId = null;
      s.importId = null;
    },
    setSelecting: (s, e) => {
      s.selecting = e.selecting;
      if (!e.selecting) s.selectedIds = [];
    },
    toggleSelected: (s, e) => {
      const idx = s.selectedIds.indexOf(e.id);
      if (idx >= 0) {
        s.selectedIds = s.selectedIds.filter((id) => id !== e.id);
      } else {
        s.selectedIds = [...s.selectedIds, e.id];
      }
    },
    setSelectedIds: (s, e) => {
      s.selectedIds = e.ids;
    },
    clearSelection: (s) => {
      s.selectedIds = [];
    },
  };
  const scope = useScope({
    initial: (): StreamWorkflowState => ({
      query: "",
      colourId: null,
      importId: null,
      selecting: false,
      selectedIds: [],
    }),
    handlers,
  });

  const { query, colourId, importId, selecting, selectedIds } =
    useScopeState(scope);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const archiveWrite = useExternalWrite<string[], void>({
    execute: (ids) => archiveFragments(ids),
    concurrency: "ignore",
    invalidates: () => [kalaidoscopeCollectionTag(client.baseURL, "fragment")],
  });

  const unarchiveWrite = useExternalWrite<string[], void>({
    execute: (ids) => unarchiveFragments(ids),
    concurrency: "allow",
    invalidates: () => [kalaidoscopeCollectionTag(client.baseURL, "fragment")],
  });

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
          ingestRef: f.ingest_ref ?? "",
          preview: f.content || "",
        };
      }),
    [records, swatches],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !colourId && !importId) return fragments;
    return fragments.filter(
      (f) =>
        (!colourId || f.colourIds.includes(colourId)) &&
        (!importId || f.ingestRef === importId) &&
        (!q ||
          f.title?.toLowerCase().includes(q) ||
          f.preview.toLowerCase().includes(q) ||
          f.type.toLowerCase().includes(q)),
    );
  }, [fragments, query, colourId, importId]);

  const selectedVisible = useMemo(
    () => visible.filter((f) => selected.has(f.id)).map((f) => f.id),
    [visible, selected],
  );

  async function restore(ids: string[]) {
    const outcome = await unarchiveWrite.run(ids);
    if (outcome.status === "error") {
      toast.error("Couldn't restore", { description: outcome.error.message });
    }
  }

  async function archiveSelected() {
    const ids = selectedVisible;
    if (ids.length === 0) return;
    const outcome = await archiveWrite.run(ids);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't archive", { description: outcome.error.message });
      return;
    }
    void scope.dispatch({ type: "clearSelection" });
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
  }

  function openOrToggle(id: string) {
    if (selecting) void scope.dispatch({ type: "toggleSelected", id });
    else onOpenFragment(id);
  }

  let lastDay: string | null = null;

  return (
    <>
      <PageHeader
        title="Stream"
        actions={
          fragments.length > 0 ? (
            <Button variant="section" onClick={onOpenImport}>
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
            onQueryChange={(next) =>
              void scope.dispatch({ type: "setQuery", query: next })
            }
            colours={colours.records.map((c) => ({
              id: c.id,
              name: c.name,
              swatch: c.swatch ?? 0,
            }))}
            colourId={colourId}
            onColourChange={(next) =>
              void scope.dispatch({ type: "setColourId", colourId: next })
            }
            imports={imports}
            importId={importId}
            onImportChange={(next) =>
              void scope.dispatch({ type: "setImportId", importId: next })
            }
            shown={visible.length}
            total={fragments.length}
            selecting={selecting}
            onSelectingChange={(next) =>
              void scope.dispatch({ type: "setSelecting", selecting: next })
            }
            selectedCount={selectedVisible.length}
            onSelectAll={() =>
              void scope.dispatch({
                type: "setSelectedIds",
                ids: visible.map((f) => f.id),
              })
            }
            onClearSelection={() =>
              void scope.dispatch({ type: "clearSelection" })
            }
            onArchive={() => void archiveSelected()}
            archiving={archiveWrite.isPending}
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
            <StreamEmptyState onImport={onOpenImport} />
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-body-sm text-fg-3">No fragments match.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void scope.dispatch({ type: "clearFilters" })}
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
      <FragmentDrawer id={selectedId} onClose={onCloseFragment} />
    </>
  );
}
