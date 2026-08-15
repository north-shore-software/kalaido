import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { GitForkIcon } from "lucide-react";
import { toast } from "sonner";
import { regenerateProjection } from "@/api/kalaidoscope/projections";
import { parseContextSpec } from "@/api/kalaidoscope/chat";
import type { ContextSpec } from "@/api/kalaidoscope/chat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TimelineItem } from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { ProjectionDraftEditor } from "@/features/projections/components/projection-draft-editor";
import { ProjectionSideRail } from "@/features/projections/components/projection-side-rail";
import { SnapshotPreview } from "@/features/projections/components/snapshot-preview";
import { getProjectionStatus } from "@/features/projections/status";
import { useLiveCollection } from "@/hooks/use-live-collection";
import {
  parseProjectionOutput,
  useProjectionSnapshot,
} from "@/hooks/use-projection-snapshot";
import { useRefineSession } from "@/hooks/use-refine-session";
import { useResumeRefinement } from "@/hooks/use-resume-refinement";
import { useContextSources } from "@/hooks/use-context-sources";
import { useRotationStatus } from "@/hooks/use-rotation-status";
import { formatShortDateTime } from "@/lib/datetime";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { projectionDetailTransitions } from "./ProjectionDetail.transitions";

export default function ProjectionDetail() {
  const { id, snapshotId } = useParams<{ id: string; snapshotId?: string }>();
  const { go } = useAppNavigate();
  const { state, projection, snapshots, liveSnapshot } =
    useProjectionSnapshot(id);
  const [regenerating, setRegenerating] = useState(false);

  const readOnly = !!snapshotId;
  const title = projection?.name || "Projection";

  // In read-only mode, load the viewed snapshot by id independently of the
  // timeline list, so a direct link works even for a snapshot that isn't shown
  // there (e.g. a discarded one).
  const historicalQuery = useLiveCollection("projection_snapshot", {
    filter: snapshotId ? `id="${snapshotId}"` : undefined,
    enabled: readOnly,
  });
  const historical = readOnly ? historicalQuery.records[0] : undefined;
  const historicalContent = historical
    ? parseProjectionOutput(historical.output).content
    : undefined;

  // A projection with no snapshots may still have an uncommitted refinement
  // draft — "New Projection" opens the refinement on the first message but only
  // materializes a snapshot on approve. Resume that draft rather than showing an
  // empty shell. Scoped to authoring sessions (empty projection_snapshot_id) so
  // we never reopen a refinement that was started over a review candidate; once
  // any snapshot exists this never triggers.
  const noSnapshots = !readOnly && state.status === "empty";
  const session = useRefineSession({ target: "projection" });
  const {
    openRefinement,
    context: refineContext,
    resumed,
  } = useResumeRefinement({
    session,
    parentId: id,
    snapshotId: "",
    enabled: noSnapshots,
  });

  async function handleRefresh() {
    if (!id || regenerating) return;
    setRegenerating(true);
    // Refresh regenerates a *pending* candidate rather than touching live, so
    // send the user to review it.
    const res = await regenerateProjection(id);
    setRegenerating(false);
    if (res.isErr()) {
      toast.error("Failed to refresh", { description: res.error.message });
      return;
    }
    go(projectionDetailTransitions.reviewCandidate, {
      params: { id, snapshotId: res.value.snapshotId },
    });
  }

  // Drive the side-rail card off the server's freshness plan (GET /api/rotation)
  // so Refresh only appears when the live snapshot is actually out of date. A
  // pending candidate awaiting review takes precedence over staleness.
  const pendingCandidate = snapshots.find((s) => s.status === "pending");
  const {
    byId: statusById,
    isLoading: rotLoading,
    refetch: refetchRotation,
  } = useRotationStatus();
  const info = id
    ? getProjectionStatus(statusById.get(id), !!pendingCandidate)
    : undefined;
  // /api/rotation is a plain fetch, not realtime — recompute it whenever the
  // snapshot set changes (approve, regenerate, or a new snapshot streaming in)
  // so the card reflects the current state without a manual reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Trigger a refresh when new snapshots are available.
  useEffect(() => {
    refetchRotation();
  }, [snapshots.length, liveSnapshot?.id, refetchRotation]);

  // Name whatever this projection is waiting on. The picker's source lists are
  // already loaded and SWR-cached app-wide, so this costs nothing extra.
  const sources = useContextSources();
  const blockedNames = useMemo(() => {
    if (!info?.blockedBy.length) return [];
    const byId = new Map(
      [...sources.projections, ...sources.reflections].map((o) => [
        o.id,
        o.name,
      ]),
    );
    return info.blockedBy.map((dep) => byId.get(dep) ?? "an upstream input");
  }, [info?.blockedBy, sources.projections, sources.reflections]);

  /**
   * Fork this projection into a new one. The two modes differ only in what the
   * child reads:
   *
   * - `refine` — it reads *this projection's output*, i.e. a further stage in a
   *   pipeline. Its draft starts empty: a refining stage is a different document,
   *   so there is nothing sensible to pre-fill.
   * - `orthogonal` — it reads *this projection's inputs*, i.e. a sibling view of
   *   the same material under a different lens. Its draft starts from the current
   *   output, which is the closest thing to "like this, but…".
   *
   * Neither writes anything here: the fork is born blank and its context is
   * committed from the refinement, exactly like any other new projection. An
   * abandoned fork is just an empty projection.
   */
  function fork(mode: "refine" | "orthogonal") {
    if (!id) return;
    const parentSpec = projection?.current_context_spec;
    const seed =
      mode === "refine"
        ? {
            name: `${title} — next stage`,
            draft: "",
            contextSpec: { sourceProjectionIds: [id] },
          }
        : {
            name: `${title} (fork)`,
            draft: liveSnapshot
              ? parseProjectionOutput(liveSnapshot.output).content
              : "",
            contextSpec: (parseContextSpec(parentSpec) ??
              undefined) as ContextSpec | undefined,
          };
    go(projectionDetailTransitions.fork, { state: { seed } });
  }

  const liveId = liveSnapshot?.id;
  const history = snapshots.filter((s) => s.status !== "discarded");
  const historicalVersionIndex = history.findIndex((s) => s.id === snapshotId);
  const historicalVersion =
    historicalVersionIndex >= 0
      ? history.length - historicalVersionIndex
      : undefined;

  const timeline: TimelineItem[] = history.map((snap, i) => {
    const version = history.length - i;
    const pending = snap.status === "pending";
    const isLive = snap.id === liveId;
    return {
      id: snap.id,
      label: `v${version}${pending ? " · candidate" : ""}`,
      note: formatShortDateTime(snap.created),
      current: isLive,
      pending,
      active: snap.id === snapshotId,
      onClick: () => {
        if (pending)
          go(projectionDetailTransitions.reviewCandidate, {
            params: { id, snapshotId: snap.id },
          });
        else if (isLive)
          go(projectionDetailTransitions.viewLive, { params: { id } });
        else
          go(projectionDetailTransitions.viewSnapshot, {
            params: { id, snapshotId: snap.id },
          });
      },
    };
  });

  if (resumed && id) {
    return (
      <ProjectionDraftEditor
        session={session}
        projectionId={id}
        title={title}
        crumb={["Projections", title, "Draft"]}
        initialContext={refineContext}
        onCancel={() => go(projectionDetailTransitions.backToList)}
        onApproveSuccess={(projId) =>
          go(projectionDetailTransitions.openDetail, { params: { id: projId } })
        }
      />
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title={title}
        crumb={[
          "Projections",
          title,
          ...(readOnly
            ? [historicalVersion ? `v${historicalVersion}` : "snapshot"]
            : []),
        ]}
        actions={
          !readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline">
                    <GitForkIcon />
                    Fork
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem onClick={() => fork("refine")}>
                  <div className="flex flex-col gap-0.5">
                    <span>Refine into a further stage</span>
                    <span className="text-[11px] text-fg-3">
                      Reads this projection's output
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fork("orthogonal")}>
                  <div className="flex flex-col gap-0.5">
                    <span>Another view of the same material</span>
                    <span className="text-[11px] text-fg-3">
                      Reads this projection's inputs
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <SnapshotPreview
            state={state}
            awaitingDraftResume={!!openRefinement}
            readOnly={readOnly}
            historical={historical}
            historicalContent={historicalContent}
            historicalLoading={historicalQuery.isLoading}
            historicalVersion={historicalVersion}
          />
          <ProjectionSideRail
            readOnly={readOnly}
            rotLoading={rotLoading}
            info={info}
            blockedNames={blockedNames}
            onReviewCandidate={
              pendingCandidate
                ? () =>
                    go(projectionDetailTransitions.reviewCandidate, {
                      params: { id, snapshotId: pendingCandidate.id },
                    })
                : undefined
            }
            regenerating={regenerating}
            onRefresh={() => void handleRefresh()}
            onBackToLive={() =>
              go(projectionDetailTransitions.viewLive, { params: { id } })
            }
            timeline={timeline}
          />
        </div>
      </PageCard>
    </PageLayout>
  );
}

export const projectionDetailRoute = defineRoute({
  id: "projection-detail",
  path: "/projections/:id",
  aliases: ["/projections/:id/snapshot/:snapshotId"],
  feature: "Projections",
  requiredScope: ["kalaidoscope"],
  transitions: projectionDetailTransitions,
  Component: ProjectionDetail,
});
