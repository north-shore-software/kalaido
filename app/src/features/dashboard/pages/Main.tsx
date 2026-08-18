import { useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { toast } from "sonner";
import { PageHeader, PageLayout } from "@/components/layout/page-layout";
import { isPinned } from "@/lib/pins";
import { useRotationStatus } from "@/hooks/use-rotation-status";
import {
  useLiveCollection,
  useLiveCollectionWatching,
} from "@/hooks/use-live-collection";
import {
  regenerateProjection,
  updateProjection,
} from "@/api/kalaidoscope/projections";
import { updateReflection } from "@/api/kalaidoscope/reflections";
import { startReconcile } from "@/api/kalaidoscope/reconcile";
import { hasDelta, isActionable } from "@/api/kalaidoscope/rotation";
import { describeDelta } from "../describe-delta";
import { formatDayGroup, formatTime } from "@/lib/datetime";
import { fragmentTypeLabel } from "@/lib/labels";
import type { FragmentTypeOptions } from "@/api/kalaidoscope/types";
import { defineRoute } from "@/routes/route-kit";
import { mainTransitions } from "./Main.transitions";

import type { NeedAction, NeedItem, PinItem, RecentFragment } from "../types";
import { CaughtUpBanner } from "../components/caught-up-banner";
import { NeedsActionSection } from "../components/needs-action-section";
import { PinnedSection } from "../components/pinned-section";
import { RecentFragmentsSidebar } from "../components/recent-fragments-sidebar";

type EntityKind = "projection" | "reflection";

/** Parse a `view_stream.colours` cell (JSON string or array) into indices. */
function parseColours(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function Main() {
  const { go } = useAppNavigate();
  // Id of the row whose candidate is being generated, so the row can say so —
  // generation is a model call, not an instant hop.
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const {
    statuses,
    isLoading: rotLoading,
    refetch: refetchRotation,
  } = useRotationStatus();
  const projections = useLiveCollection("projection", {
    filter: 'name != ""',
    sort: "-updated",
  });
  const reflections = useLiveCollection("reflection", {
    filter: 'name != ""',
    sort: "-updated",
  });
  // Latest pending candidate per projection — the snapshot to review.
  const pending = useLiveCollection("projection_snapshot", {
    filter: 'status="pending"',
    sort: "-created",
    fields: "id,projection_id",
  });
  const fragments = useLiveCollectionWatching(
    "view_stream",
    ["fragment", "colour_fragment"],
    { sort: "-source_time,-created" },
  );

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

  // The freshness plan is computed per request, so it goes stale while the
  // dashboard sits open — approve a candidate elsewhere and everything
  // downstream of it changes state. Recompute whenever the records it derives
  // from move. Keyed by content, not array identity, so a revalidation that
  // changed nothing doesn't re-fetch.
  const planInputsKey = useMemo(
    () =>
      [
        pending.records.map((s) => s.id).join(","),
        fragments.records.length,
        projections.records.length,
        reflections.records.length,
      ].join("|"),
    [
      pending.records,
      fragments.records,
      projections.records,
      reflections.records,
    ],
  );
  // The key the plan we're holding was fetched against; null until first sync.
  const planSyncedKey = useRef<string | null>(null);
  useEffect(() => {
    if (planSyncedKey.current === planInputsKey) return;
    const firstSync = planSyncedKey.current === null;
    planSyncedKey.current = planInputsKey;
    // The hook fetches once on mount already; only re-fetch on later changes.
    if (!firstSync) refetchRotation();
  }, [planInputsKey, refetchRotation]);

  const pinned = useMemo<PinItem[]>(() => {
    const items: PinItem[] = [];
    for (const p of projections.records)
      if (isPinned(p.pinned_by))
        items.push({
          id: p.id,
          kind: "projection",
          name: p.name || "Untitled projection",
        });
    for (const r of reflections.records)
      if (isPinned(r.pinned_by))
        items.push({
          id: r.id,
          kind: "reflection",
          name: r.name || "Untitled reflection",
        });
    return items;
  }, [projections.records, reflections.records]);

  const needsAction = useMemo<NeedItem[]>(
    () =>
      statuses.filter(hasDelta).map((s) => {
        const candidateId =
          s.type === "projection" ? candidateByProjection.get(s.id) : undefined;
        // Reflections publish without a review gate, so the dashboard never
        // starts one from here — it opens them instead.
        const action: NeedAction = candidateId
          ? "review"
          : s.type === "projection" && isActionable(s)
            ? "refresh"
            : "open";
        return {
          id: s.id,
          kind: s.type as EntityKind,
          name:
            nameById.get(s.id) ??
            (s.type === "reflection" ? "Reflection" : "Projection"),
          meta: describeDelta(s, (dep) => nameById.get(dep) ?? "an upstream"),
          action,
          candidateId,
        };
      }),
    [statuses, nameById, candidateByProjection],
  );
  const caughtUp = !rotLoading && needsAction.length === 0;

  const recent = useMemo<RecentFragment[]>(
    () =>
      fragments.records.slice(0, 8).map((f) => {
        const occurred = f.source_time || f.created;
        return {
          id: f.id,
          type: fragmentTypeLabel(f.type as FragmentTypeOptions),
          time: formatTime(occurred),
          day: formatDayGroup(occurred),
          colours: parseColours(f.colours),
        };
      }),
    [fragments.records],
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

  /**
   * Take up a row in "needs action". A projection with work to do goes straight
   * into review — generating the candidate first if there isn't one — rather
   * than stopping at its detail page, which is a step on the way to the same
   * place. Blocked items have nothing to review yet, so they just open.
   */
  async function startWork(it: NeedItem) {
    if (it.kind === "reflection") {
      go(mainTransitions.openReflection, { params: { id: it.id } });
      return;
    }
    if (it.candidateId) {
      go(mainTransitions.reviewProjection, {
        params: { id: it.id, snapshotId: it.candidateId },
      });
      return;
    }
    if (it.action !== "refresh") {
      go(mainTransitions.openProjection, { params: { id: it.id } });
      return;
    }
    if (refreshing) return;

    setRefreshing(it.id);
    const res = await regenerateProjection(it.id);
    setRefreshing(null);
    if (res.isErr()) {
      toast.error("Failed to refresh", { description: res.error.message });
      return;
    }
    go(mainTransitions.reviewProjection, {
      params: { id: it.id, snapshotId: res.value.snapshotId },
    });
  }

  /**
   * Kick off a backend generation wave over the whole stale set. Fire and
   * forget: the dashboard has no run state to track — candidates arrive
   * through the live subscriptions and rows flip to "Review" as they land,
   * while the utility bar shows the queue working.
   */
  async function generateAll() {
    const res = await startReconcile();
    if (res.isErr()) {
      toast.error("Failed to start generating", {
        description: res.error.message,
      });
    }
  }

  async function unpin(it: PinItem) {
    const res =
      it.kind === "projection"
        ? await updateProjection(it.id, { pinned: false })
        : await updateReflection(it.id, { pinned: false });
    if (res.isErr())
      toast.error("Failed to unpin", { description: res.error.message });
    // useLiveCollection revalidates on the resulting update.
  }

  return (
    <PageLayout>
      <PageHeader title="Dashboard" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-5 pb-6">
            {caughtUp && <CaughtUpBanner />}

            <NeedsActionSection
              items={needsAction}
              onAction={startWork}
              busyId={refreshing}
              onGenerateAll={generateAll}
            />

            <PinnedSection items={pinned} onOpen={openEntity} onUnpin={unpin} />
          </div>

          <RecentFragmentsSidebar
            fragments={recent}
            loading={fragments.isLoading}
          />
        </div>
      </div>
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
