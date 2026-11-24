import { NewProjectionScreen } from "@kalaido/features/projections";
import { useCallback } from "react";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { newProjectionTransitions } from "./NewProjection.transitions";

export default function NewProjection() {
  const { go } = useAppNavigate();
  const { seed } = useAppRouteState<"new-projection">();
  const handleCancel = useCallback(
    () => go(newProjectionTransitions.cancel),
    [go],
  );
  const handleApproveSuccess = useCallback(
    (id: string) =>
      go(newProjectionTransitions.approveSuccess, { params: { id } }),
    [go],
  );

  return (
    <PageLayout>
      <NewProjectionScreen
        seed={seed}
        onCancel={handleCancel}
        onApproveSuccess={handleApproveSuccess}
      />
    </PageLayout>
  );
}

export const newProjectionRoute = defineRoute({
  id: "new-projection",
  path: "/projections/new",
  feature: "Projections",
  requiredScope: ["kalaidoscope"],
  transitions: newProjectionTransitions,
  Component: NewProjection,
});
