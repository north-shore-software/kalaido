import type { UIMessage } from "ai";
import { useEffect, useMemo } from "react";
import { parseActiveContext, specToItems } from "@/api/kalaidoscope/chat";
import { normalizeRefinementMessages } from "@/api/kalaidoscope/refinements";
import type { RefineProjSnapshotConversationResponse } from "@/api/kalaidoscope/types";
import type { ContextItem } from "@/components/kalaido";
import { useLiveCollection } from "@/hooks/use-live-collection";
import type { RefineSession } from "@/hooks/use-refine-session";

/**
 * Finds the in-progress refinement for a projection scope and adopts it into a
 * {@link RefineSession}, so a page re-entered mid-refinement resumes the chat and
 * live draft instead of showing an empty shell. Shared by the two surfaces that
 * can be left mid-refinement and returned to:
 * - {@link ProjectionDetail} authoring a brand-new projection — scope
 *   `snapshotId=""` (a draft that hasn't materialized a snapshot yet).
 * - {@link ProjectionReview} refining a pending candidate — scope
 *   `snapshotId=<pendingId>`.
 *
 * The two differ only in that scope; everything else — the conversation lookup,
 * loading its persisted history, and the guarded `resume` — is identical, and the
 * guard is load-bearing rather than cosmetic (see the effect below).
 *
 * Scoped to projections: both real call sites are projections, and the reflection
 * detail view opens its session eagerly (`start`) with no resume path. If a
 * reflection resume site ever appears, lift the collection / FK / parent-field
 * names into a `target` lookup here.
 */
export function useResumeRefinement({
  session,
  parentId,
  snapshotId,
  enabled,
}: {
  session: RefineSession;
  /** Projection id. */
  parentId: string | undefined;
  /** Snapshot scope: "" for an authoring draft, the pending id for a review candidate. */
  snapshotId: string;
  /** Gate the whole lookup (e.g. only when the projection is empty, or a candidate exists). */
  enabled: boolean;
}): {
  openRefinement: RefineProjSnapshotConversationResponse | undefined;
  messages: UIMessage[];
  context: ContextItem[];
  /** The session has adopted this refinement. */
  resumed: boolean;
  /** The conversation and its history have finished loading. */
  ready: boolean;
} {
  const active = enabled && !!parentId;
  const conversationQuery = useLiveCollection(
    "refine_proj_snapshot_conversation",
    {
      filter: parentId
        ? `projection_id="${parentId}" && projection_snapshot_id="${snapshotId}"`
        : undefined,
      sort: "-created",
      enabled: active,
    },
  );
  const openRefinement = active ? conversationQuery.records[0] : undefined;

  const messagesQuery = useLiveCollection("chat_message", {
    filter: openRefinement
      ? `refine_proj_conversation_id="${openRefinement.id}"`
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

  // Adopt the refinement once we know which one it is and its history has
  // loaded, so the chat and live preview seed correctly.
  const ready =
    !!openRefinement?.external_conversation_id && !messagesQuery.isLoading;
  const resumed =
    !!openRefinement && session.refinementId === openRefinement.id;
  const { resume } = session;
  useEffect(() => {
    if (!ready || !openRefinement?.external_conversation_id) return;
    // Idempotency guard — also the regression guard: once a *fresh* refinement is
    // started here (start sets refinementId to this same id), the live query
    // picks up its row; without this bail the effect would clobber the live /
    // streaming session with the stale persisted messages.
    if (session.refinementId === openRefinement.id) return;
    resume({
      clientId: openRefinement.external_conversation_id,
      refinementId: openRefinement.id,
      messages,
    });
  }, [ready, openRefinement, messages, session.refinementId, resume]);

  return { openRefinement, messages, context, resumed, ready };
}
