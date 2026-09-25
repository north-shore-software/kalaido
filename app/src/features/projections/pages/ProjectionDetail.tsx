import { DotsThreeIcon, GitForkIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ContextSpec } from "@/api/kalaidoscope/chat";
import { parseContextSpec } from "@/api/kalaidoscope/chat";
import {
  deleteProjection,
  GenerationInFlightError,
  regenerateProjection,
  restoreProjection,
  updateProjection,
} from "@/api/kalaidoscope/projections";
import { PanelErrorBoundary, type TimelineItem } from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectionDraftEditor } from "@/features/projections/components/projection-draft-editor";
import { ProjectionSideRail } from "@/features/projections/components/projection-side-rail";
import { SnapshotPreview } from "@/features/projections/components/snapshot-preview";
import { getProjectionStatus } from "@/features/projections/status";
import { useContextSources } from "@/hooks/use-context-sources";
import { useDraftName } from "@/hooks/use-draft-name";
import { useLiveCollection } from "@/hooks/use-live-collection";
import {
  parseProjectionOutput,
  useProjectionSnapshot,
} from "@/hooks/use-projection-snapshot";
import { useRefineSession } from "@/hooks/use-refine-session";
import { useResumeRefinement } from "@/hooks/use-resume-refinement";
import { useRotationStatus } from "@/hooks/use-rotation-status";
import { formatShortDateTime } from "@/lib/datetime";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { projectionDetailTransitions } from "./ProjectionDetail.transitions";

export default function ProjectionDetail() {
  const { id, snapshotId } = useAppParams<"projection-detail">();
  const { go } = useAppNavigate();
  const { state, projection, snapshots, liveSnapshot, generating } =
    useProjectionSnapshot(id);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pendingCandidate = snapshots.find((s) => s.status === "pending_review");
  const readOnly = !!snapshotId;

  useEffect(() => {
    if (state.status === "missing") {
      go(projectionDetailTransitions.backToList, { replace: true });
    }
  }, [state.status, go]);

  useEffect(() => {
    if (
      state.status !== "loading" &&
      !readOnly &&
      !liveSnapshot &&
      pendingCandidate &&
      id
    ) {
      go(projectionDetailTransitions.reviewCandidate, {
        params: { id, snapshotId: pendingCandidate.id },
        replace: true,
      });
    }
  }, [state.status, readOnly, liveSnapshot, pendingCandidate, id, go]);

  async function remove() {
    if (!id) return;
    const res = await deleteProjection(id);
    if (res.isErr()) {
      if (res.error instanceof GenerationInFlightError) {
        toast.error("Can't delete while generating", {
          description: res.error.message,
        });
      } else {
        toast.error("Failed to delete projection", {
          description: res.error.message,
        });
      }
      return;
    }
    go(projectionDetailTransitions.backToList, { replace: true });
    toast("Projection deleted", {
      description: "Find it under Recently deleted to restore later.",
      action: {
        label: "Undo",
        onClick: () =>
          void restoreProjection(id).then((r) => {
            if (r.isErr()) {
              toast.error("Failed to restore", {
                description: r.error.message,
              });
            }
          }),
      },
    });
  }

  const title = projection?.name || "Projection";

  const historicalQuery = useLiveCollection("projection_snapshot", {
    filter: snapshotId ? `id="${snapshotId}"` : undefined,
    enabled: readOnly,
  });
  const historical = readOnly ? historicalQuery.records[0] : undefined;
  const historicalContent = historical
    ? parseProjectionOutput(historical.output).content
    : undefined;

  const noSnapshots = !readOnly && state.status === "empty";
  const authoringSession = useRefineSession({ target: "projection" });
  const { context: authoringRefineContext, resumed } = useResumeRefinement({
    session: authoringSession,
    parentId: id,
    snapshotId: "",
    enabled: noSnapshots,
  });

  const draftName = useDraftName({
    target: "projection",
    entityId: id ?? null,
    suggestedName: resumed ? authoringSession.suggestedName : "",
  });
  const { adopt: adoptDraftName } = draftName;
  useEffect(() => {
    if (!resumed || !projection || draftName.name !== null) return;
    const suggestion = authoringSession.suggestedName;
    adoptDraftName(
      projection.name || "Untitled projection",
      suggestion !== "" && projection.name !== suggestion,
    );
  }, [
    resumed,
    projection,
    draftName.name,
    authoringSession.suggestedName,
    adoptDraftName,
  ]);

  async function handleRefresh() {
    if (!id || regenerating) return;
    setRegenerating(true);
    const res = await regenerateProjection(id);
    setRegenerating(false);
    if (res.isErr()) {
      toast.error("Couldn't refresh", { description: res.error.message });
      return;
    }
    go(projectionDetailTransitions.reviewCandidate, {
      params: { id, snapshotId: res.value.snapshotId },
    });
  }

  const {
    byId: statusById,
    isLoading: rotLoading,
    refetch: refetchRotation,
  } = useRotationStatus();
  const info = id
    ? getProjectionStatus(statusById.get(id), !!pendingCandidate, {
        generating: generating || regenerating,
        lensMissing: snapshots.length > 0 && !projection?.current_lens_id,
      })
    : undefined;

  const newSinceCandidate =
    statusById.get(id ?? "")?.candidate?.newFragmentIds?.length ?? 0;

  const snapshotCount = snapshots.length;
  const liveSnapshotId = liveSnapshot?.id;
  useEffect(() => {
    if (snapshotCount >= 0 || liveSnapshotId) {
      refetchRotation();
    }
  }, [snapshotCount, liveSnapshotId, refetchRotation]);

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
              ? (parseProjectionOutput(liveSnapshot.output).content ?? "")
              : "",
            contextSpec: (parseContextSpec(parentSpec) ?? undefined) as
              | ContextSpec
              | undefined,
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
    const pending = snap.status === "pending_review";
    const isLive = snap.id === liveId;
    return {
      id: snap.id,
      label: `v${version}${pending ? " · candidate" : ""}`,
      note: formatShortDateTime(snap.created),
      current: isLive,
      pending,
      active: snap.id === (snapshotId ?? liveId),
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
    const draftTitle = draftName.name ?? title;
    return (
      <ProjectionDraftEditor
        session={authoringSession}
        projectionId={id}
        title={draftTitle}
        crumb={["Projections", draftTitle, "Draft"]}
        initialContext={authoringRefineContext}
        onTitleCommit={draftName.rename}
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
        onTitleCommit={
          !readOnly && id
            ? (next) =>
                void updateProjection(id, { name: next }).then((res) => {
                  if (res.isErr()) {
                    toast.error("Failed to rename", {
                      description: res.error.message,
                    });
                  }
                })
            : undefined
        }
        actions={
          !readOnly && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="outline">
                      <GitForkIcon />
                      Branch
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem onClick={() => fork("refine")}>
                    <div className="flex flex-col gap-0.5">
                      <span>Refine into next stage</span>
                      <span className="text-meta text-fg-3">
                        Reads this projection's output
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => fork("orthogonal")}>
                    <div className="flex flex-col gap-0.5">
                      <span>Alternate view</span>
                      <span className="text-meta text-fg-3">
                        Reads this projection's inputs
                      </span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="ghost" aria-label="More actions">
                      <DotsThreeIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon />
                    Delete projection
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this projection?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything that reads it as a source stops doing so. Its history is
              kept, and you can restore it from the projections list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <PanelErrorBoundary label="the preview" resetKey={snapshotId ?? id}>
            <SnapshotPreview
              state={state}
              awaitingDraftResume={!!resumed}
              readOnly={readOnly}
              historical={historical}
              historicalContent={historicalContent}
              historicalLoading={historicalQuery.isLoading}
              historicalVersion={historicalVersion}
            />
          </PanelErrorBoundary>
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
            newSinceCandidate={newSinceCandidate}
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
