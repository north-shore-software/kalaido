import { ProjectionReviewScreen } from "@kalaido/features/projections";
import { useCallback } from "react";
import { PageLayout } from "@/components/layout/page-layout";
import { AppRedirect } from "@/routes/app-redirect";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { projectionReviewTransitions } from "./ProjectionReview.transitions";

export default function ProjectionReview() {
  const { id, snapshotId } = useAppParams<"projection-review">();
  const { go } = useAppNavigate();

  const handleViewReview = useCallback(
    (projId: string, nextSnapshotId: string, opts?: { replace?: boolean }) =>
      go(projectionReviewTransitions.viewReview, {
        params: { id: projId, snapshotId: nextSnapshotId },
        replace: opts?.replace,
      }),
    [go],
  );

  const renderCandidateRedirect = useCallback(
    (projId: string, nextSnapshotId: string) => (
      <AppRedirect
        transition={projectionReviewTransitions.viewReview}
        params={{ id: projId, snapshotId: nextSnapshotId }}
        replace
      />
    ),
    [],
  );

  return (
    <PageLayout>
      <ProjectionReviewScreen
        id={id}
        snapshotId={snapshotId}
        onViewReview={handleViewReview}
        renderCandidateRedirect={renderCandidateRedirect}
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
        onBackToList={(opts) =>
          go(projectionReviewTransitions.backToList, opts)
        }
      />
    </PageLayout>
  );
}
