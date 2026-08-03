import { useMemo } from "react";
import { PlusIcon } from "lucide-react";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { defineRoute } from "@/routes/route-kit";
import { projectionsTransitions } from "./Projections.transitions";
import { toast } from "sonner";
import {
  PageBody,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/kalaido";
import { isPinned } from "@/lib/pins";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { useRotationStatus } from "@/hooks/use-rotation-status";
import { getProjectionStatus } from "@/features/projections/status";
import { updateProjection } from "@/api/kalaidoscope/projections";
import type { ProjectionResponse } from "@/api/kalaidoscope/types";
import { ProjCard } from "@/features/projections/components/projection-card";

async function togglePin(p: ProjectionResponse) {
  const res = await updateProjection(p.id, { pinned: !isPinned(p.pinned_by) });
  if (res.isErr())
    toast.error("Failed to update pin", { description: res.error.message });
}

export default function Projections() {
  const { go } = useAppNavigate();

  const { records: projections, isLoading } = useLiveCollection("projection", {
    filter: 'name != ""',
    sort: "-updated",
  });
  const pending = useLiveCollection("projection_snapshot", {
    filter: 'status="pending"',
    sort: "-created",
    fields: "id,projection_id",
  });
  const candidateByProjection = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of pending.records) {
      // records are newest-first, so the first seen per projection is latest.
      if (!map.has(s.projection_id)) map.set(s.projection_id, s.id);
    }
    return map;
  }, [pending.records]);

  const { byId: statusById } = useRotationStatus();

  return (
    <PageLayout>
      <PageHeader
        title="Projections"
        crumb={["Kalaidoscope"]}
        actions={
          <Button
            size="sm"
            onClick={() => go(projectionsTransitions.newProjection)}
          >
            <PlusIcon />
            New Projection
          </Button>
        }
      />
      <PageBody>
        {projections.length === 0 ? (
          <EmptyState>
            {isLoading
              ? "Loading projections…"
              : "No projections yet. Create one to get started."}
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-4">
            {projections.map((p) => {
              const candidateId = candidateByProjection.get(p.id);
              return (
                <ProjCard
                  key={p.id}
                  p={p}
                  candidateId={candidateId}
                  status={getProjectionStatus(
                    statusById.get(p.id),
                    !!candidateId,
                  )}
                  onOpen={(id) =>
                    go(projectionsTransitions.openProjection, {
                      params: { id },
                    })
                  }
                  onReview={(id, candId) =>
                    go(projectionsTransitions.reviewProjection, {
                      params: { id, snapshotId: candId },
                    })
                  }
                  onTogglePin={() => void togglePin(p)}
                />
              );
            })}
          </div>
        )}
      </PageBody>
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
