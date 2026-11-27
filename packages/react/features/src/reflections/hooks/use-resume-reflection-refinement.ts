import {
  type ContextItem,
  parseActiveContext,
  specToItems,
} from "@kalaido/client/kalaidoscope/chat";
import {
  extractLatestLensFromMessages,
  normalizeRefinementMessages,
} from "@kalaido/client/kalaidoscope/refinements";
import type { ReflectionRefinementResponse } from "@kalaido/client/kalaidoscope/types";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import type { ResumedRefinementSeed } from "@kalaido/hooks/use-refine-session";
import type { UIMessage } from "ai";
import { useMemo } from "react";

/**
 * Pure read hook that finds an in-progress refinement for a never-saved
 * reflection (`!current_lens_id`) and produces a declarative
 * {@link ResumedRefinementSeed} once its persisted transcript finishes loading.
 */
export function useResumeReflectionRefinement({
  reflectionId,
  enabled,
}: {
  reflectionId: string | undefined;
  /** Gate lookup to never-saved reflections only (`!existing.current_lens_id`). */
  enabled: boolean;
}): {
  openRefinement: ReflectionRefinementResponse | undefined;
  messages: UIMessage[];
  context: ContextItem[];
  latestLens: string;
  seed: ResumedRefinementSeed | null;
  /** True while querying the latest refinement row or its persisted messages. */
  loading: boolean;
  /** True once lookup settled (either with a resumable seed or none found). */
  ready: boolean;
} {
  const active = enabled && !!reflectionId;
  const conversationQuery = useLiveCollection("reflection_refinement", {
    filter: reflectionId ? `reflection_id="${reflectionId}"` : undefined,
    sort: "-created",
    enabled: active,
  });
  const openRefinement = active ? conversationQuery.records[0] : undefined;

  const messagesQuery = useLiveCollection("chat_message", {
    filter: openRefinement
      ? `reflection_refinement_id="${openRefinement.id}"`
      : undefined,
    sort: "created",
    enabled: !!openRefinement,
  });

  const messages = useMemo<UIMessage[]>(
    () =>
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

  const latestLens = useMemo(
    () => extractLatestLensFromMessages(messages),
    [messages],
  );

  const loading =
    active &&
    (conversationQuery.isLoading ||
      (Boolean(openRefinement) && messagesQuery.isLoading));
  const ready = !active || !loading;

  const seed = useMemo<ResumedRefinementSeed | null>(() => {
    if (!active || loading || !openRefinement?.external_conversation_id) {
      return null;
    }
    return {
      parentId: reflectionId,
      clientId: openRefinement.external_conversation_id,
      refinementId: openRefinement.id,
      messages,
    };
  }, [active, loading, openRefinement, reflectionId, messages]);

  return {
    openRefinement,
    messages,
    context,
    latestLens,
    seed,
    loading,
    ready,
  };
}
