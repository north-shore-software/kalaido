import { RotationScreen } from "@kalaido/features/rotation";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { rotationTransitions } from "./Rotation.transitions";

export default function Rotation() {
  const { go } = useAppNavigate();
  return (
    <PageLayout>
      <RotationScreen
        onTweakCandidate={(id, snapshotId) =>
          go(rotationTransitions.tweakCandidate, {
            params: { id, snapshotId },
            state: { wave: true },
          })
        }
      />
    </PageLayout>
  );
}

export const rotationRoute = defineRoute({
  id: "rotation",
  path: "/rotation",
  feature: "Rotation",
  requiredScope: ["kalaidoscope"],
  transitions: rotationTransitions,
  Component: Rotation,
});
