import { ReflectionRefineScreen } from "@kalaido/features/reflections";
import { PageLayout } from "@/components/layout/page-layout";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { reflectionRefineTransitions } from "./ReflectionRefine.transitions";

export default function ReflectionRefine() {
  const { go } = useAppNavigate();
  // One component, two routes: `new-reflection` carries no params.
  const params = useAppParams<"new-reflection" | "refine-reflection">();
  const id = params?.id;
  const { seed } = useAppRouteState<"refine-reflection">();

  return (
    <PageLayout>
      <ReflectionRefineScreen
        id={id}
        seed={seed}
        onCancel={(reflId) =>
          go(reflectionRefineTransitions.cancel, {
            params: reflId ? { id: reflId } : {},
          })
        }
        onCommitSuccess={(reflId) =>
          go(reflectionRefineTransitions.commitSuccess, {
            params: { id: reflId },
          })
        }
      />
    </PageLayout>
  );
}
