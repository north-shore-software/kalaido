import { startTransition, useMemo, useOptimistic, useState } from "react";
import { toast } from "sonner";
import { parseContextSpec } from "@/api/kalaidoscope/chat";
import {
  deleteProjection,
  updateProjection,
} from "@/api/kalaidoscope/projections";
import {
  deleteReflection,
  updateReflection,
} from "@/api/kalaidoscope/reflections";
import type { FragmentTypeOptions } from "@/api/kalaidoscope/types";
import { FragmentDrawer } from "@/components/kalaido";
import { PageHeader, PageLayout } from "@/components/layout/page-layout";
import { resolveSources } from "@/features/projections/sources";
import { openAddFragmentModal } from "@/hooks/app-state-actions.ts";
import {
  resolveSwatches,
  useColourSwatches,
} from "@/hooks/use-colour-swatches";
import { useContextSources } from "@/hooks/use-context-sources";
import {
  useLiveCollection,
  useLiveCollectionWatching,
} from "@/hooks/use-live-collection";
import { useOrganizeStatus } from "@/hooks/use-organize-status";
import { formatDayGroup, formatTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import {
  CaptureFragmentCard,
  ExploreCard,
  ImportNotesCard,
} from "../components/action-cards";
import { ImportNotesDialog } from "../components/import-notes-dialog";
import { PinnedSection } from "../components/pinned-section";
import { ProposedSection } from "../components/proposed-section";
import { RecentFragmentsSidebar } from "../components/recent-fragments-sidebar";
import type {
  EntityKind,
  PinItem,
  ProposedItem,
  RecentFragment,
} from "../types";
import { mainTransitions } from "./Main.transitions";

/** Projections and reflections share an id space only by accident; key on both. */
function itemKey(it: { kind: EntityKind; id: string }): string {
  return `${it.kind}:${it.id}`;
}

export default function Main() {
  const { go } = useAppNavigate();
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
      go(mainTransitions.openReflection, { params: { id: it.id } });
      return;
    }
    const candidateId = candidateByProjection.get(it.id);
    if (candidateId) {
      go(mainTransitions.reviewProjection, {
        params: { id: it.id, snapshotId: candidateId },
      });
    } else {
      go(mainTransitions.openProjection, { params: { id: it.id } });
    }
  }

  function openProposal(it: ProposedItem) {
    if (it.kind === "reflection") {
      // The proposed row already carries its scope and schedule; the refine
      // screen only needs the opening message to send as the first turn.
      go(mainTransitions.openProposedReflection, {
        params: { id: it.id },
        state: { seed: { message: it.message } },
      });
      return;
    }
    const row = projections.records.find((p) => p.id === it.id);
    if (!row) return;
    go(mainTransitions.openProposal, {
      state: {
        seed: {
          id: it.id,
          name: it.name,
          draft: "",
          message: it.message,
          contextSpec: parseContextSpec(row.current_context_spec) ?? undefined,
        },
      },
    });
  }

  function dismissProposal(item: ProposedItem) {
    startTransition(async () => {
      hideProposed(itemKey(item));
      const res =
        item.kind === "projection"
          ? await deleteProjection(item.id)
          : await deleteReflection(item.id);
      if (res.isErr()) {
        toast.error("Failed to dismiss", { description: res.error.message });
        return;
      }

      // Hold the optimistic row-less list until the live list agrees, so the
      // row never flashes back between the call and the realtime revalidation.
      await revalidate(item.kind);
    });
  }

  function unpin(item: PinItem) {
    startTransition(async () => {
      hidePinned(itemKey(item));
      const res =
        item.kind === "projection"
          ? await updateProjection(item.id, { pinned: false })
          : await updateReflection(item.id, { pinned: false });
      if (res.isErr()) {
        toast.error("Failed to unpin", { description: res.error.message });
        return;
      }
      await revalidate(item.kind);
    });
  }

  function revalidate(kind: EntityKind) {
    return kind === "projection" ? projections.mutate() : reflections.mutate();
  }

  return (
    <PageLayout>
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
                  onClick={() => openAddFragmentModal()}
                />
                <ExploreCard
                  layout="hero"
                  onClick={() => go(mainTransitions.openExplore)}
                />
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
        onImportSuccess={(ingestId) => {
          setImportDialogOpen(false);

          if (hasFragments) {
            go(mainTransitions.toApp);
          } else {
            go(mainTransitions.startPipeline, {
              params: { ingestId },
              replace: true,
            });
          }
        }}
      />
    </PageLayout>
  );
}

export const mainRoute = defineRoute({
  id: "main",
  path: "/main",
  feature: "Dashboard",
  requiredScope: ["kalaidoscope"],
  transitions: mainTransitions,
  Component: Main,
});
