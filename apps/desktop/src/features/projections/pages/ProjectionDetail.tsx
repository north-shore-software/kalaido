import {
  ProjectionDetailScreen,
  type ProjectionSeed,
} from "@kalaido/features/projections";
import { useCallback } from "react";
import { PageLayout } from "@/components/layout/page-layout";
import { AppRedirect } from "@/routes/app-redirect";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { projectionDetailTransitions } from "./ProjectionDetail.transitions";

export default function ProjectionDetail() {
  const { id, snapshotId } = useAppParams<"projection-detail">();
  const { go } = useAppNavigate();

  const handleBackToList = useCallback(
    (opts?: { replace?: boolean }) =>
      go(projectionDetailTransitions.backToList, opts),
    [go],
  );
  const handleReviewCandidate = useCallback(
    (projId: string, nextSnapshotId: string, opts?: { replace?: boolean }) =>
      go(projectionDetailTransitions.reviewCandidate, {
        params: { id: projId, snapshotId: nextSnapshotId },
        ...opts,
      }),
    [go],
  );
  const handleViewLive = useCallback(
    (projId: string) =>
      go(projectionDetailTransitions.viewLive, { params: { id: projId } }),
    [go],
  );
  const handleViewSnapshot = useCallback(
    (projId: string, nextSnapshotId: string) =>
      go(projectionDetailTransitions.viewSnapshot, {
        params: { id: projId, snapshotId: nextSnapshotId },
      }),
    [go],
  );
  const handleFork = useCallback(
    (seed: ProjectionSeed) =>
      go(projectionDetailTransitions.fork, { state: { seed } }),
    [go],
  );
  const handleOpenDetail = useCallback(
    (projId: string) =>
      go(projectionDetailTransitions.openDetail, { params: { id: projId } }),
    [go],
  );

  const renderReviewRedirect = useCallback(
    (projId: string, nextSnapshotId: string) => (
      <AppRedirect
        transition={projectionDetailTransitions.reviewCandidate}
        params={{ id: projId, snapshotId: nextSnapshotId }}
        replace
      />
    ),
    [],
  );

  return (
    <PageLayout>
      <ProjectionDetailScreen
        id={id}
        snapshotId={snapshotId}
        onBackToList={handleBackToList}
        onReviewCandidate={handleReviewCandidate}
        renderReviewRedirect={renderReviewRedirect}
        onViewLive={handleViewLive}
        onViewSnapshot={handleViewSnapshot}
        onFork={handleFork}
        onOpenDetail={handleOpenDetail}
      />
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
