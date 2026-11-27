import { ProjectionsScreen } from "@kalaido/features/projections";
import { PageLayout } from "@/components/layout/page-layout";
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
        onStartUpdate={(id, snapshotId) =>
          go(projectionsTransitions.reviewProjection, {
            params: { id, snapshotId },
          })
        }
      />
    </PageLayout>
  );
}
