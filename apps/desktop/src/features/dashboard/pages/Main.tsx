import { DashboardScreen } from "@kalaido/features/dashboard";
import { PageLayout } from "@/components/layout/page-layout";
import { desktopImportAdapter } from "@/features/import/desktop-import-adapter";
import { openAddFragmentModal } from "@/hooks/app-state-actions.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { mainTransitions } from "./Main.transitions";

export default function Main() {
  const { go } = useAppNavigate();
  return (
    <PageLayout>
      <DashboardScreen
        importAdapter={desktopImportAdapter}
        onOpenAddFragment={() => openAddFragmentModal()}
        onOpenExplore={() => go(mainTransitions.openExplore)}
        onOpenReflection={(id) =>
          go(mainTransitions.openReflection, { params: { id } })
        }
        onOpenProjection={(id) =>
          go(mainTransitions.openProjection, { params: { id } })
        }
        onReviewProjection={(id, snapshotId) =>
          go(mainTransitions.reviewProjection, {
            params: { id, snapshotId },
          })
        }
        onOpenProposedReflection={(id, seed) =>
          go(mainTransitions.openProposedReflection, {
            params: { id },
            state: { seed },
          })
        }
        onOpenProposal={(seed) =>
          go(mainTransitions.openProposal, { state: { seed } })
        }
        onImportToApp={() => go(mainTransitions.toApp)}
        onStartPipeline={(ingestId) =>
          go(mainTransitions.startPipeline, {
            params: { ingestId },
            replace: true,
          })
        }
      />
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
