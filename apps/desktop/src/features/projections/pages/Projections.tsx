import { ProjectionsScreen } from "@kalaido/features/projections";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { projectionsTransitions } from "./Projections.transitions";

export default function Projections() {
  const { go } = useAppNavigate();
  return (
    <PageLayout>
      <ProjectionsScreen
        onNewProjection={() => go(projectionsTransitions.newProjection)}
        onOpenProjection={(id) =>
          go(projectionsTransitions.openProjection, { params: { id } })
        }
        onReviewProjection={(id, snapshotId) =>
          go(projectionsTransitions.reviewProjection, {
            params: { id, snapshotId },
          })
        }
      />
    </PageLayout>
  );
}

export const projectionsRoute = defineRoute({
  id: "projections",
  path: "/projections",
  feature: "Projections",
  requiredScope: ["kalaidoscope"],
  transitions: projectionsTransitions,
  Component: Projections,
});
