import { RotationScreen } from "@kalaido/features/rotation";
import { PageLayout } from "@/components/layout/page-layout";
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
