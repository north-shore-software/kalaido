import { parseContextSpec } from "@kalaido/client/kalaidoscope/chat";
import {
  deleteProjection,
  updateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import {
  deleteReflection,
  updateReflection,
} from "@kalaido/client/kalaidoscope/reflections";
import type { FragmentTypeOptions } from "@kalaido/client/kalaidoscope/types";
import { formatDayGroup, formatTime } from "@kalaido/client/lib/datetime";
import { fragmentTypeLabel } from "@kalaido/client/lib/labels";
import { FragmentDrawer, PageHeader } from "@kalaido/components";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import {
  resolveSwatches,
  useColourSwatches,
} from "@kalaido/hooks/use-colour-swatches";
import { useContextSources } from "@kalaido/hooks/use-context-sources";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import {
  useLiveCollection,
  useLiveCollectionWatching,
} from "@kalaido/hooks/use-live-collection";
import { useOrganizeStatus } from "@kalaido/hooks/use-organize-status";
import { useExternalWrite } from "@kalaido/state/live";
import { startTransition, useMemo, useOptimistic, useState } from "react";
import { toast } from "sonner";
import type { ImportAdapter } from "#import";
import { type ProjectionSeed, resolveSources } from "#projections";
import type { ReflectionSeed } from "#reflections";
import {
  CaptureFragmentCard,
  ExploreCard,
  ImportNotesCard,
} from "./components/action-cards";
import { ImportNotesDialog } from "./components/import-notes-dialog";
import { PinnedSection } from "./components/pinned-section";
import { ProposedSection } from "./components/proposed-section";
import { RecentFragmentsSidebar } from "./components/recent-fragments-sidebar";
import type {
  EntityKind,
  PinItem,
  ProposedItem,
  RecentFragment,
} from "./types";

/** Projections and reflections share an id space only by accident; key on both. */
function itemKey(it: { kind: EntityKind; id: string }): string {
  return `${it.kind}:${it.id}`;
}

export interface DashboardScreenProps {
  importAdapter: ImportAdapter;
  onOpenAddFragment: () => void;
  onOpenExplore: () => void;
  onOpenReflection: (id: string) => void;
  onOpenProjection: (id: string) => void;
  onReviewProjection: (id: string, snapshotId: string) => void;
  onOpenProposedReflection: (id: string, seed: ReflectionSeed) => void;
  onOpenProposal: (seed: ProjectionSeed) => void;
  onImportToApp: () => void;
  onStartPipeline: (ingestId: string) => void;
}

export function DashboardScreen({
  importAdapter,
  onOpenAddFragment,
  onOpenExplore,
  onOpenReflection,
  onOpenProjection,
  onReviewProjection,
  onOpenProposedReflection,
  onOpenProposal,
  onImportToApp,
  onStartPipeline,
}: DashboardScreenProps) {
  const client = useKalaidoscopeClient();
  const contextSources = useContextSources();
  const [selectedFragmentId, setSelectedFragmentId] = useState<string | null>(
    null,
  );
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const projections = useLiveCollection("projection", {
    filter: 'name != "" && deleted_at = ""',
    sort: "-updated",
  });
  const reflections = useLiveCollection("reflection", {
    filter: 'name != "" && deleted_at = ""',
    sort: "-updated",
  });
  // Latest pending candidate per projection — the snapshot to review.
  const pending = useLiveCollection("projection_snapshot", {
    filter: 'status="pending_review" && projection_id.deleted_at = ""',
    sort: "-created",
    fields: "id,projection_id",
  });
  const fragments = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment", "fragment_annotation"],
    {
      sort: "-occurred_at,-created",
      filter: "archived_at = ''",
      fields: "id,type,occurred_at,created,title,colour_ids",
    },
  );
  const swatches = useColourSwatches();
  // Projections and reflections discovery keep running after onboarding lets
  // the user in; the Proposed section says so until they finish.
  const { status: organize } = useOrganizeStatus();
  const laterKinds = ["projections", "reflections"] as const;
  const discovering = laterKinds.some(
    (k) =>
      organize?.discover.running === k ||
      organize?.discover.pending.includes(k),
  );
  const discoverError = discovering
    ? undefined
    : laterKinds
        .map((k) => organize?.discover.runs[k])
        .find((r) => r?.status === "error" && r.error)?.error;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projections.records)
      m.set(p.id, p.name || "Untitled projection");
    for (const r of reflections.records)
      m.set(r.id, r.name || "Untitled reflection");
    return m;
  }, [projections.records, reflections.records]);

  const candidateByProjection = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of pending.records) {
      // records are newest-first, so the first seen per projection is latest.
      if (!m.has(s.projection_id)) m.set(s.projection_id, s.id);
    }
    return m;
  }, [pending.records]);

  const proposed = useMemo<ProposedItem[]>(() => {
    const items: ProposedItem[] = [];
    const rows = [
      ...projections.records.map((p) => ({ kind: "projection" as const, p })),
      ...reflections.records.map((p) => ({ kind: "reflection" as const, p })),
    ];
    for (const { kind, p } of rows) {
      if (p.status !== "proposed") continue;
      const spec = parseContextSpec(p.current_context_spec);
      items.push({
        id: p.id,
        kind,
        name: p.name || "Untitled",
        message: p.description ?? "",
        sources: resolveSources(spec, contextSources, nameById),
      });
    }
    return items;
  }, [projections.records, reflections.records, contextSources, nameById]);

  const pinned = useMemo<PinItem[]>(() => {
    const items: PinItem[] = [];
    for (const p of projections.records)
      if (p.status === "active" && p.pinned)
        items.push({
          id: p.id,
          kind: "projection",
          name: p.name || "Untitled projection",
        });
    for (const r of reflections.records)
      if (r.status === "active" && r.pinned)
        items.push({
          id: r.id,
          kind: "reflection",
          name: r.name || "Untitled reflection",
        });
    return items;
  }, [projections.records, reflections.records]);

  // A row leaves the screen the moment it is acted on. The live collections
  // catch up behind it — or, if the call failed, React drops the optimistic
  // value and the row is back, with a toast saying why.
  const [visibleProposed, hideProposed] = useOptimistic(
    proposed,
    (items: ProposedItem[], key: string) =>
      items.filter((item) => itemKey(item) !== key),
  );
  const [visiblePinned, hidePinned] = useOptimistic(
    pinned,
    (items: PinItem[], key: string) =>
      items.filter((item) => itemKey(item) !== key),
  );

  const hasFragments = fragments.records.length > 0;

  const recent = useMemo<RecentFragment[]>(
    () =>
      fragments.records.slice(0, 8).map((f) => {
        const occurred = f.occurred_at || f.created;
        return {
          id: f.id,
          type: fragmentTypeLabel(f.type as FragmentTypeOptions),
          title: f.title,
          time: formatTime(occurred),
          day: formatDayGroup(occurred),
          colours: resolveSwatches(f.colour_ids, swatches),
        };
      }),
    [fragments.records, swatches],
  );

  function openEntity(it: PinItem) {
    if (it.kind === "reflection") {
      onOpenReflection(it.id);
      return;
    }
    const candidateId = candidateByProjection.get(it.id);
    if (candidateId) {
      onReviewProjection(it.id, candidateId);
    } else {
      onOpenProjection(it.id);
    }
  }

  function openProposal(it: ProposedItem) {
    if (it.kind === "reflection") {
      // The proposed row already carries its scope and schedule; the refine
      // screen only needs the opening message to send as the first turn.
      onOpenProposedReflection(it.id, { message: it.message });
      return;
    }
    const row = projections.records.find((p) => p.id === it.id);
    if (!row) return;
    onOpenProposal({
      id: it.id,
      name: it.name,
      draft: "",
      message: it.message,
      contextSpec: parseContextSpec(row.current_context_spec) ?? undefined,
    });
  }

  const dismissWrite = useExternalWrite<ProposedItem, void>({
    execute: (item) =>
      item.kind === "projection"
        ? deleteProjection(item.id)
        : deleteReflection(item.id),
    concurrency: "allow",
    invalidates: (item) => [
      kalaidoscopeCollectionTag(client.baseURL, item.kind),
    ],
  });

  const unpinWrite = useExternalWrite<PinItem, void>({
    execute: async (item) => {
      const res =
        item.kind === "projection"
          ? await updateProjection(item.id, { pinned: false })
          : await updateReflection(item.id, { pinned: false });
      return res.map(() => undefined);
    },
    concurrency: "allow",
    invalidates: (item) => [
      kalaidoscopeCollectionTag(client.baseURL, item.kind),
    ],
  });

  function dismissProposal(item: ProposedItem) {
    startTransition(async () => {
      hideProposed(itemKey(item));
      // `dismissWrite.run` awaits invalidation of the matching live collection
      // so the optimistic row-less list holds until the live list agrees.
      const outcome = await dismissWrite.run(item);
      if (outcome.status === "error") {
        toast.error("Failed to dismiss", {
          description: outcome.error.message,
        });
      }
    });
  }

  function unpin(item: PinItem) {
    startTransition(async () => {
      hidePinned(itemKey(item));
      const outcome = await unpinWrite.run(item);
      if (outcome.status === "error") {
        toast.error("Failed to unpin", { description: outcome.error.message });
      }
    });
  }

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-5 pb-6">
            {!hasFragments && !fragments.isLoading && (
              <div className="flex flex-wrap items-stretch gap-4">
                <ImportNotesCard
                  layout="hero"
                  onClick={() => setImportDialogOpen(true)}
                />
                <CaptureFragmentCard
                  layout="hero"
                  onClick={onOpenAddFragment}
                />
                <ExploreCard layout="hero" onClick={onOpenExplore} />
              </div>
            )}

            <ProposedSection
              items={visibleProposed}
              discovering={discovering}
              error={discoverError}
              onOpen={openProposal}
              onDismiss={dismissProposal}
            />

            {hasFragments && (
              <PinnedSection
                items={visiblePinned}
                onOpen={openEntity}
                onUnpin={unpin}
              />
            )}
          </div>

          <RecentFragmentsSidebar
            fragments={recent}
            loading={fragments.isLoading}
            onSelectFragment={setSelectedFragmentId}
          />
        </div>
      </div>
      <FragmentDrawer
        id={selectedFragmentId ?? undefined}
        onClose={() => setSelectedFragmentId(null)}
      />
      <ImportNotesDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        importAdapter={importAdapter}
        onImportSuccess={(ingestId) => {
          setImportDialogOpen(false);

          if (hasFragments) {
            onImportToApp();
          } else {
            onStartPipeline(ingestId);
          }
        }}
      />
    </>
  );
}
