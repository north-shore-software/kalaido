import type { ContextSpec } from "@kalaido/client/kalaidoscope/chat";
import { parseContextSpec } from "@kalaido/client/kalaidoscope/chat";
import {
  deleteProjection,
  GenerationInFlightError,
  parseProjectionOutput,
  regenerateProjection,
  restoreProjection,
  updateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { PageHeader, PanelErrorBoundary } from "@kalaido/components";
import { useContextSources } from "@kalaido/hooks/use-context-sources";
import { useDraftName } from "@kalaido/hooks/use-draft-name";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useRefineSession } from "@kalaido/hooks/use-refine-session";
import { useRotationStatus } from "@kalaido/hooks/use-rotation-status";
import type { TimelineItem } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@kalaido/primitives/shadcn/alert-dialog";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kalaido/primitives/shadcn/dropdown-menu";
import { DotsThreeIcon, GitForkIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ProjectionDraftEditor } from "./components/projection-draft-editor";
import { ProjectionSideRail } from "./components/projection-side-rail";
import { useProjectionSnapshot } from "./hooks/use-projection-snapshot";
import { useResumeRefinement } from "./hooks/use-resume-refinement";
import { SnapshotPreview } from "./components/snapshot-preview";
import { getProjectionStatus } from "./status";
import type { ProjectionSeed } from "./types";

export interface ProjectionDetailScreenProps {
  id: string;
  snapshotId?: string;
  onBackToList: (opts?: { replace?: boolean }) => void;
  onReviewCandidate: (
    id: string,
    snapshotId: string,
    opts?: { replace?: boolean },
  ) => void;
  onViewLive: (id: string) => void;
  onViewSnapshot: (id: string, snapshotId: string) => void;
  onFork: (seed: ProjectionSeed) => void;
  onOpenDetail: (id: string) => void;
}

export function ProjectionDetailScreen({
  id,
  snapshotId,
  onBackToList,
  onReviewCandidate,
  onViewLive,
  onViewSnapshot,
  onFork,
  onOpenDetail,
}: ProjectionDetailScreenProps) {
  const { state, projection, snapshots, liveSnapshot, generating } =
    useProjectionSnapshot(id);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pendingCandidate = snapshots.find((s) => s.status === "pending_review");
  const readOnly = !!snapshotId;

  useEffect(() => {
    if (state.status === "missing") {
      onBackToList({ replace: true });
    }
  }, [state.status, onBackToList]);

  useEffect(() => {
    if (
      state.status !== "loading" &&
      !readOnly &&
      !liveSnapshot &&
      pendingCandidate &&
      id
    ) {
      onReviewCandidate(id, pendingCandidate.id, { replace: true });
    }
  }, [
    state.status,
    readOnly,
    liveSnapshot,
    pendingCandidate,
    id,
    onReviewCandidate,
  ]);

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
    onBackToList({ replace: true });
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
  const {
    openRefinement,
    context: authoringRefineContext,
    resumed,
  } = useResumeRefinement({
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
      // 409s carry a specific reason (lens still preparing, generation
      // already running) — surface the server's own message.
      toast.error("Couldn't regenerate", { description: res.error.message });
      return;
    }
    onReviewCandidate(id, res.value.id);
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
    const seed: ProjectionSeed =
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
    onFork(seed);
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
        if (pending) onReviewCandidate(id, snap.id);
        else if (isLive) onViewLive(id);
        else onViewSnapshot(id, snap.id);
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
        onCancel={() => onBackToList()}
        onApproveSuccess={onOpenDetail}
      />
    );
  }

  return (
    <>
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
              awaitingDraftResume={!!openRefinement}
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
            generatedAt={liveSnapshot?.generated_at || liveSnapshot?.created}
            blockedNames={blockedNames}
            onReviewCandidate={
              pendingCandidate
                ? () => onReviewCandidate(id, pendingCandidate.id)
                : undefined
            }
            newSinceCandidate={newSinceCandidate}
            regenerating={regenerating}
            onRefresh={() => void handleRefresh()}
            onBackToLive={() => onViewLive(id)}
            timeline={timeline}
          />
        </div>
      </PageCard>
    </>
  );
}
