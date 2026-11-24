import { ExploreScreen } from "@kalaido/features/explore";
import { PageLayout } from "@/components/layout/page-layout";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { exploreTransitions } from "./Explore.transitions";

export default function Explore() {
  const { go } = useAppNavigate();
  const seed = useAppRouteState<"explore">();
  return (
    <PageLayout>
      <ExploreScreen
        initialPrompt={seed?.initialPrompt}
        onNewColourFromBookmarks={(positiveExamples) =>
          go(exploreTransitions.newColourFromBookmarks, {
            state: { seed: { positiveExamples } },
          })
        }
        onGraduateToProjection={(projectionSeed) =>
          go(exploreTransitions.graduateToProjection, {
            state: { seed: projectionSeed },
          })
        }
      />
    </PageLayout>
  );
}

export const exploreRoute = defineRoute({
  id: "explore",
  path: "/explore",
  aliases: ["/chat"],
  feature: "Explore",
  requiredScope: ["kalaidoscope"],
  transitions: exploreTransitions,
  Component: Explore,
});
