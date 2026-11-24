import { ReflectionsScreen } from "@kalaido/features/reflections";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { reflectionsTransitions } from "./Reflections.transitions";

export default function Reflections() {
  const { go } = useAppNavigate();
  const { id, windowId } = useAppParams<"reflections">();
  return (
    <PageLayout>
      <ReflectionsScreen
        id={id}
        windowId={windowId}
        onNewReflection={() => go(reflectionsTransitions.newReflection)}
        onSelectReflection={(nextId) =>
          go(reflectionsTransitions.selectReflection, {
            params: { id: nextId },
          })
        }
        onSelectWindow={(reflId, nextWindowId) =>
          go(reflectionsTransitions.viewWindow, {
            params: { id: reflId, windowId: nextWindowId },
          })
        }
        onRefine={(reflId) =>
          go(reflectionsTransitions.refine, { params: { id: reflId } })
        }
      />
    </PageLayout>
  );
}

export const reflectionsRoute = defineRoute({
  id: "reflections",
  path: "/reflections/:id?",
  aliases: ["/reflections/:id/window/:windowId"],
  feature: "Reflections",
  requiredScope: ["kalaidoscope"],
  transitions: reflectionsTransitions,
  Component: Reflections,
});
