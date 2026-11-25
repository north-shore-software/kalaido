import {
  type ContextItem,
  parseActiveContext,
  specToItems,
} from "@kalaido/client/kalaidoscope/chat";
import { normalizeRefinementMessages } from "@kalaido/client/kalaidoscope/refinements";
import type { ProjectionRefinementResponse } from "@kalaido/client/kalaidoscope/types";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import type { ResumedRefinementSeed } from "@kalaido/hooks/use-refine-session";
import type { UIMessage } from "ai";
import { useMemo } from "react";

/**
 * Pure read hook that finds an in-progress refinement for a projection scope
 * and produces a declarative {@link ResumedRefinementSeed} once its persisted
 * history finishes loading. Passed directly into {@link useRefineSession}
 * (via {@link useProjectionRefinement}) so resuming requires zero upward
 * `useEffect` sync.
 */
export function useResumeRefinement({
  parentId,
  snapshotId,
  enabled,
}: {
  /** Projection id. */
  parentId: string | undefined;
  /** Snapshot scope: "" for an authoring draft, the pending id for a review candidate. */
  snapshotId: string;
  /** Gate the whole lookup (e.g. only when the projection is empty, or a candidate exists). */
  enabled: boolean;
}): {
  openRefinement: ProjectionRefinementResponse | undefined;
  messages: UIMessage[];
  context: ContextItem[];
  seed: ResumedRefinementSeed | null;
  /** The conversation and its history have finished loading. */
  ready: boolean;
} {
  const active = enabled && !!parentId;
  const conversationQuery = useLiveCollection("projection_refinement", {
    filter: parentId
      ? `projection_id="${parentId}" && projection_snapshot_id="${snapshotId}"`
      : undefined,
    sort: "-created",
    enabled: active,
  });
  const openRefinement = active ? conversationQuery.records[0] : undefined;

  const messagesQuery = useLiveCollection("chat_message", {
    filter: openRefinement
      ? `projection_refinement_id="${openRefinement.id}"`
      : undefined,
    sort: "created",
    enabled: !!openRefinement,
  });
  const messages = useMemo<UIMessage[]>(
    () =>
      // Persisted assistant tool turns are stored in the backend's
      // `tool-<name>` shape; normalize them to the AI SDK's `dynamic-tool` shape
      // so a resumed draft seeds the live preview (and Approve) correctly.
      normalizeRefinementMessages(
        messagesQuery.records
          .map((r) => r.content as UIMessage | null)
          .filter((m): m is UIMessage => m != null),
      ),
    [messagesQuery.records],
  );
  const context = useMemo<ContextItem[]>(() => {
    const spec = parseActiveContext(messages);
    return spec ? specToItems(spec) : [];
  }, [messages]);

  const ready =
    !!openRefinement?.external_conversation_id && !messagesQuery.isLoading;

  const seed = useMemo<ResumedRefinementSeed | null>(() => {
    if (!ready || !openRefinement?.external_conversation_id) return null;
    return {
      parentId,
      clientId: openRefinement.external_conversation_id,
      refinementId: openRefinement.id,
      messages,
    };
  }, [ready, openRefinement, parentId, messages]);

  return { openRefinement, messages, context, seed, ready };
}
