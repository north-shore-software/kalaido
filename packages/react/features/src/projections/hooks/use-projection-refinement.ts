import type { ContextItem } from "@kalaido/client/kalaidoscope/chat";
import type { ProjectionRefinementResponse } from "@kalaido/client/kalaidoscope/types";
import {
  type RefineSession,
  useRefineSession,
} from "@kalaido/hooks/use-refine-session";
import type { UIMessage } from "ai";
import { useResumeRefinement } from "./use-resume-refinement";

/**
 * Composite projection refinement hook combining persisted-refinement lookup
 * (`useResumeRefinement`) with `useRefineSession({ target: "projection", resumed })`
 * for `ProjectionDetailScreen` and `ProjectionReviewScreen`.
 */
export function useProjectionRefinement({
  parentId,
  snapshotId,
  enabled,
}: {
  parentId: string | undefined;
  snapshotId: string;
  enabled: boolean;
}): {
  session: RefineSession;
  openRefinement: ProjectionRefinementResponse | undefined;
  resumedMessages: UIMessage[];
  context: ContextItem[];
  resumed: boolean;
  ready: boolean;
} {
  const {
    openRefinement,
    messages: resumedMessages,
    context,
    seed,
    ready,
  } = useResumeRefinement({
    parentId,
    snapshotId,
    enabled,
  });

  const session = useRefineSession({
    target: "projection",
    resumed: seed,
  });

  const resumed =
    !!openRefinement && session.refinementId === openRefinement.id;

  return {
    session,
    openRefinement,
    resumedMessages,
    context,
    resumed,
    ready,
  };
}
