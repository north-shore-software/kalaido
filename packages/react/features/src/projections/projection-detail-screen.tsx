import { extractSuggestedNameFromMessages } from "@kalaido/client/kalaidoscope/refinements";
import { PageHeader, PanelErrorBoundary } from "@kalaido/components";
import { useContextSources } from "@kalaido/hooks/use-context-sources";
import { useDraftName } from "@kalaido/hooks/use-draft-name";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useFreshnessStatus } from "@kalaido/hooks/use-freshness-status";
import { ConfirmDialog } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ProjectionBriefDialog } from "./components/projection-brief-dialog";
import { ProjectionDetailActions } from "./components/projection-detail-actions";
import { ProjectionDraftEditor } from "./components/projection-draft-editor";
import { ProjectionSideRail } from "./components/projection-side-rail";
import { SnapshotPreview } from "./components/snapshot-preview";
import {
  buildDraftNameSeed,
  buildForkSeed,
  buildSnapshotTimeline,
  deriveDetailHeaderState,
  deriveFreshnessSummary,
  deriveHistoricalSnapshot,
  resolveUpstreamNames,
  shouldRedirectToPendingReview,
} from "./detail-helpers";
import { useProjectionDetailActions } from "./hooks/use-projection-detail-actions";
import { useProjectionRefinement } from "./hooks/use-projection-refinement";
import { useProjectionSnapshot } from "./hooks/use-projection-snapshot";
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
  renderReviewRedirect?: (id: string, snapshotId: string) => ReactNode;
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
  renderReviewRedirect,
  onViewLive,
  onViewSnapshot,
  onFork,
  onOpenDetail,
}: ProjectionDetailScreenProps) {
  const { state, projection, snapshots, liveSnapshot, generating } =
    useProjectionSnapshot(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);

  const {
    regenerating,
    revising,
    remove,
    handleRefresh,
    handleRevise,
    handleRename,
  } = useProjectionDetailActions({ id, onBackToList, onReviewCandidate });

  const pendingCandidate = snapshots.find((s) => s.status === "pending_review");
  const readOnly = !!snapshotId;

  useEffect(() => {
    if (state.status === "missing") {
      onBackToList({ replace: true });
    }
  }, [state.status, onBackToList]);

  const historicalQuery = useLiveCollection("projection_snapshot", {
    filter: snapshotId ? `id="${snapshotId}"` : undefined,
    enabled: readOnly,
  });
  const { historical, historicalContent } = deriveHistoricalSnapshot(
    readOnly,
    historicalQuery.records,
  );

  const {
    session: authoringSession,
    openRefinement,
    resumedMessages,
    context: authoringRefineContext,
    resumed,
  } = useProjectionRefinement({
    parentId: id,
    snapshotId: "",
    enabled: !readOnly && state.status === "empty",
  });

  const resumedSuggestedName = useMemo(
    () => extractSuggestedNameFromMessages(resumedMessages),
    [resumedMessages],
  );
  const draftNameSeed = useMemo(
    () => buildDraftNameSeed(resumed, projection, resumedSuggestedName),
    [resumed, projection, resumedSuggestedName],
  );
  const draftName = useDraftName({
    target: "projection",
    entityId: id,
    suggestedName: resumed ? authoringSession.suggestedName : "",
    seed: draftNameSeed,
  });

  const { byId: statusById, isLoading: freshnessLoading } =
    useFreshnessStatus();
  const freshnessEntry = statusById.get(id);
  const freshness = deriveFreshnessSummary({
    freshnessEntry,
    generating,
    regenerating,
    hasSnapshots: snapshots.length > 0,
    hasCurrentLens: Boolean(projection?.current_lens_id),
  });
  const info = getProjectionStatus(freshnessEntry, Boolean(pendingCandidate), {
    generating: freshness.generating,
    lensMissing: freshness.lensMissing,
  });

  const sources = useContextSources();
  const staleDependencyNames = useMemo(
    () => resolveUpstreamNames(info.staleDependencies, sources),
    [info.staleDependencies, sources],
  );

  const { timeline, historicalVersion } = buildSnapshotTimeline({
    id,
    snapshots,
    liveId: liveSnapshot?.id,
    snapshotId,
    onReviewCandidate,
    onViewLive,
    onViewSnapshot,
  });

  const header = deriveDetailHeaderState({
    id,
    projection,
    liveSnapshot,
    pendingCandidate,
    readOnly,
    historicalVersion,
    draftName: draftName.name,
  });

  const redirectToPending = shouldRedirectToPendingReview({
    status: state.status,
    readOnly,
    hasLiveSnapshot: Boolean(liveSnapshot),
    hasPendingCandidate: Boolean(pendingCandidate && renderReviewRedirect),
    id,
  });
  if (redirectToPending && pendingCandidate && renderReviewRedirect) {
    return renderReviewRedirect(id, pendingCandidate.id);
  }

  if (resumed) {
    return (
      <ProjectionDraftEditor
        session={authoringSession}
        projectionId={id}
        title={header.draftTitle}
        crumb={["Projections", header.draftTitle, "Draft"]}
        initialContext={authoringRefineContext}
        onTitleCommit={draftName.rename}
        onCancel={() => onBackToList()}
        onApproveSuccess={onOpenDetail}
      />
    );
  }

  const handleReviewPending = header.pendingCandidateId
    ? () => onReviewCandidate(id, header.pendingCandidateId as string)
    : undefined;

  return (
    <>
      <PageHeader
        title={header.title}
        crumb={header.crumb}
        onTitleCommit={
          header.canEdit ? (next) => void handleRename(next) : undefined
        }
        actions={
          !readOnly && (
            <ProjectionDetailActions
              onViewBrief={() => setBriefOpen(true)}
              onFork={(mode) =>
                onFork(
                  buildForkSeed({
                    mode,
                    id,
                    title: header.title,
                    projection,
                    liveSnapshot,
                  }),
                )
              }
              onRequestDelete={() => setConfirmDelete(true)}
            />
          )
        }
      />
      <ProjectionBriefDialog
        open={briefOpen}
        onOpenChange={setBriefOpen}
        projectionId={id}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this projection?"
        description="Anything that reads it as a source stops doing so. Its history is kept, and you can restore it from the projections list."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
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
            freshnessLoading={freshnessLoading}
            info={info}
            generatedAt={header.generatedAt}
            staleDependencyNames={staleDependencyNames}
            onReviewCandidate={handleReviewPending}
            newSinceCandidate={freshness.newSinceCandidate}
            regenerating={regenerating}
            revising={revising}
            onRefresh={() => void handleRefresh()}
            onRevise={() => void handleRevise()}
            onBackToLive={() => onViewLive(id)}
            timeline={timeline}
          />
        </div>
      </PageCard>
    </>
  );
}
