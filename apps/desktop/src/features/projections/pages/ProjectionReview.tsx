import { ProjectionReviewScreen } from "@kalaido/features/projections";
import { useCallback } from "react";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { projectionReviewTransitions } from "./ProjectionReview.transitions";

export default function ProjectionReview() {
  const { id, snapshotId } = useAppParams<"projection-review">();
  const routeState = useAppRouteState<"projection-review">();
  const { go } = useAppNavigate();

  const handleViewReview = useCallback(
    (
      projId: string,
      nextSnapshotId: string,
      opts?: { wave?: boolean; replace?: boolean },
    ) =>
      go(projectionReviewTransitions.viewReview, {
        params: { id: projId, snapshotId: nextSnapshotId },
        state: opts?.wave ? { wave: true } : undefined,
        replace: opts?.replace,
      }),
    [go],
  );

  return (
    <PageLayout>
      <ProjectionReviewScreen
        id={id}
        snapshotId={snapshotId}
        inWave={Boolean(routeState?.wave)}
        onViewReview={handleViewReview}
        onApproveSuccess={(projId) =>
          go(projectionReviewTransitions.approveSuccess, {
            params: { id: projId },
          })
        }
        onBackToDetail={(projId) =>
          go(projectionReviewTransitions.backToDetail, {
            params: { id: projId },
          })
        }
        onExitWave={() => go(projectionReviewTransitions.exitWave)}
        onCaughtUp={() => go(projectionReviewTransitions.caughtUp)}
        onReviewNext={(projId, nextSnapshotId) =>
          go(projectionReviewTransitions.reviewNext, {
            params: { id: projId, snapshotId: nextSnapshotId },
            state: { wave: true },
          })
        }
      />
    </PageLayout>
  );
}

export const projectionReviewRoute = defineRoute({
  id: "projection-review",
  path: "/projections/:id/review/:snapshotId",
  feature: "Projections",
  requiredScope: ["kalaidoscope"],
  transitions: projectionReviewTransitions,
  Component: ProjectionReview,
});
