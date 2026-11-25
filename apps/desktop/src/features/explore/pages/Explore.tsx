import { ExploreScreen } from "@kalaido/features/explore";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useCallback } from "react";
import { PageLayout } from "@/components/layout/page-layout";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { DesktopScopeContext } from "@/state/app-state";
import { exploreTransitions } from "./Explore.transitions";

export default function Explore() {
  const { go } = useAppNavigate();
  const seed = useAppRouteState<"explore">();
  const active = useActiveKalaidoscope();
  const workspaceId = active?.id ?? null;

  const root = useScopeContext(DesktopScopeContext);
  const exploreScope = useScope({
    from: root,
    state: ["recentExploreConversationIds"],
    events: ["setRecentExploreConversationId"],
  });
  const { recentExploreConversationIds } = useScopeState(exploreScope);

  const handleRecentChange = useCallback(
    (conversationId: string | null) => {
      if (!workspaceId) return;
      void exploreScope.dispatch({
        type: "setRecentExploreConversationId",
        workspaceId,
        conversationId,
      });
    },
    [exploreScope, workspaceId],
  );

  return (
    <PageLayout>
      <ExploreScreen
        initialPrompt={seed?.initialPrompt}
        recentConversationId={
          workspaceId
            ? (recentExploreConversationIds[workspaceId] ?? null)
            : null
        }
        onRecentConversationChange={handleRecentChange}
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
