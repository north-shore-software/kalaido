import type {
  ContextSpec,
  TimeWindow,
} from "@kalaido/client/kalaidoscope/chat";
import {
  commitRefinement,
  createRefinement,
  extractHasDraftedLens,
  extractPreviewFromMessages,
  extractPreviewReady,
  extractRefinePhase,
  extractSuggestedNameFromMessages,
  normalizeRefinementMessages,
  type RefinePhase,
} from "@kalaido/client/kalaidoscope/refinements";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { generateId, type UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLiveCollection } from "#use-live-collection";

export interface RefineSystemNotice {
  type: string;
  text?: string;
  data?: Record<string, unknown>;
  id?: string;
}

interface RefineControlState {
  parentId: string | null;
  clientId: string;
  refinementId: string | null;
  firstPrompt: string | null;
  initialMessages: UIMessage[] | undefined;
  seedStatus: "idle" | "loading" | "ready";
  pendingNotices: RefineSystemNotice[] | null;
}

type RefineControlEvent =
  | {
      readonly type: "startSeed";
      readonly parentId: string;
      readonly clientId: string;
      readonly refinementId: string;
      readonly firstPrompt: string | null;
      readonly pendingNotices: RefineSystemNotice[] | null;
    }
  | {
      readonly type: "seedLoaded";
      readonly messages: UIMessage[];
    }
  | {
      readonly type: "resume";
      readonly parentId?: string;
      readonly clientId: string;
      readonly refinementId: string;
      readonly messages: UIMessage[] | undefined;
    }
  | { readonly type: "reset" };

function buildSystemNoticeMessages(
  notices: readonly RefineSystemNotice[] | null,
): UIMessage[] {
  if (!notices?.length) return [];
  return notices.map((n) => {
    const part: Record<string, unknown> = {
      type: n.type,
      text: n.text ?? "",
    };
    if (n.data !== undefined) {
      part.data = n.data;
    }
    return {
      id: n.id ?? generateId(),
      role: "system",
      parts: [part],
    } as unknown as UIMessage;
  });
}

/**
 * The shared lifecycle of a "refine via chat" session, used by every surface
 * that drafts a projection/reflection through {@link ChatPanel}: New Projection,
 * New Reflection, Projection Review, the reflection detail panel, and resuming an
 * uncommitted draft. Each of those keeps its own layout and parent-creation
 * logic; this hook owns the parts they all repeat — the chat identity, the live
 * message list, the drafted-snapshot preview, and committing.
 *
 * The session has three ways to come into being:
 * - {@link RefineSession.start} — open a fresh refinement over an existing parent
 *   (callers create the parent first when authoring something brand-new).
 * - {@link RefineSession.resume} — adopt a refinement that already exists, seeding
 *   the chat with its persisted history (used to reopen an uncommitted draft).
 * - {@link RefineSession.reset} — drop the session and mint a new chat id (used
 *   when re-targeting, e.g. after a reflection commit promotes a new snapshot).
 */
export interface RefineSession {
  /** Target entity type being refined. */
  target: "projection" | "reflection";
  /** Parent entity id if known. */
  parentId: string | null;
  /** AI SDK chat id — pass to {@link ChatPanel}'s `chatId`. */
  clientId: string;
  /** Null until a refinement is opened/adopted; `started` mirrors readiness. */
  refinementId: string | null;
  /** Auto-sent once on mount when authoring fresh; pass as `initialPrompt`. */
  firstPrompt: string | null;
  /** History to seed a resumed chat; pass as `initialMessages`. */
  initialMessages: UIMessage[] | undefined;
  /** Live message list (mid-stream included), fed by `onMessagesChange`. */
  messages: UIMessage[];
  onMessagesChange: (m: UIMessage[]) => void;
  /**
   * The latest applied output scraped from the chat — the drafted lens
   * executed against the sources, mid-stream partials included (empty until
   * the first apply starts streaming).
   */
  preview: string;
  /**
   * A terminal applied output exists, so the session is committable. This is
   * the approve gate: `preview` alone can be a mid-stream partial or stale
   * next to a newer lens whose apply failed.
   */
  previewReady: boolean;
  hasDraftedLens: boolean;
  /** Where the current turn stands: drafting the lens, applying it, or done. */
  phase: RefinePhase;
  /**
   * The model's latest name suggestion for the document being shaped (empty
   * until one lands). Rides `suggest_name` calls before the first lens and
   * `update_lens`'s `suggested_name` argument afterwards.
   */
  suggestedName: string;
  /** A refinement is open and its seeded history (if any) has loaded. */
  started: boolean;
  /** A `start` call or initial seed read is in flight. */
  creating: boolean;
  /** A `commit` call is in flight. */
  committing: boolean;
  /**
   * Open a fresh refinement over `parentId`. `prompt` is remembered as the chat's
   * auto-sent first message; `snapshotId` scopes the session to an existing
   * snapshot (its context/window spec seeds the conversation). Returns whether it
   * succeeded (errors are toasted).
   */
  start: (args: {
    parentId: string;
    prompt?: string;
    snapshotId?: string;
    contextSpec?: ContextSpec;
    window?: TimeWindow;
    systemNotices?: RefineSystemNotice[];
  }) => Promise<boolean>;
  /** Adopt an already-persisted refinement, seeding the chat with its history. */
  resume: (args: {
    parentId?: string;
    clientId: string;
    refinementId: string;
    messages?: UIMessage[];
  }) => void;
  /** Drop the session and mint a new chat id. */
  reset: () => void;
  /**
   * Commit the open refinement under `parentId` (materializes/promotes a
   * snapshot). Returns whether it succeeded (errors are toasted); `onCommitted`
   * fires with the new snapshot id on success.
   */
  commit: (parentId: string) => Promise<boolean>;
}

export function useRefineSession({
  target,
  onCommitted,
}: {
  target: "projection" | "reflection";
  onCommitted?: (snapshotId: string) => void;
}): RefineSession {
  const handlers: ScopeHandlers<RefineControlState, RefineControlEvent> = {
    startSeed: (s, e) => {
      s.parentId = e.parentId;
      s.clientId = e.clientId;
      s.refinementId = e.refinementId;
      s.firstPrompt = e.firstPrompt;
      s.initialMessages = undefined;
      s.seedStatus = "loading";
      s.pendingNotices = e.pendingNotices;
    },
    seedLoaded: (s, e) => {
      if (s.seedStatus !== "loading") return;
      s.initialMessages = e.messages.length ? e.messages : undefined;
      s.seedStatus = "ready";
      s.pendingNotices = null;
    },
    resume: (s, e) => {
      s.clientId = e.clientId;
      s.refinementId = e.refinementId;
      if (e.parentId) s.parentId = e.parentId;
      s.initialMessages = e.messages;
      s.firstPrompt = null;
      s.seedStatus = "ready";
      s.pendingNotices = null;
    },
    reset: (s) => {
      s.clientId = generateId();
      s.parentId = null;
      s.refinementId = null;
      s.firstPrompt = null;
      s.initialMessages = undefined;
      s.seedStatus = "idle";
      s.pendingNotices = null;
    },
  };
  const scope = useScope({
    initial: (): RefineControlState => ({
      parentId: null,
      clientId: generateId(),
      refinementId: null,
      firstPrompt: null,
      initialMessages: undefined,
      seedStatus: "idle",
      pendingNotices: null,
    }),
    handlers,
  });

  const {
    parentId,
    clientId,
    refinementId,
    firstPrompt,
    initialMessages,
    seedStatus,
    pendingNotices,
  } = useScopeState(scope);

  // Category 5 streaming mirror fed by ChatPanel's onMessagesChange.
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const onMessagesChange = useCallback((m: UIMessage[]) => setMessages(m), []);

  const fkField =
    target === "projection"
      ? "projection_refinement_id"
      : "reflection_refinement_id";

  // Pure CQRS seed read: enabled only while waiting for freshly-created
  // refinement seed rows, then latched off so mid-turn SSE writes never race
  // `useChat`'s live stream.
  const seedQuery = useLiveCollection("chat_message", {
    filter: refinementId ? `${fkField}="${refinementId}"` : undefined,
    sort: "created",
    enabled: refinementId !== null && seedStatus === "loading",
  });

  useEffect(() => {
    if (seedStatus !== "loading" || refinementId === null) return;
    if (seedQuery.status === "ready") {
      const seeded = seedQuery.records
        .map((r) => r.content as UIMessage | null)
        .filter((m): m is UIMessage => m != null);
      const history: UIMessage[] = seeded.length
        ? [...normalizeRefinementMessages(seeded)]
        : [];
      history.push(...buildSystemNoticeMessages(pendingNotices));
      setMessages(history);
      void scope.dispatch({ type: "seedLoaded", messages: history });
    } else if (seedQuery.status === "error") {
      const fallback = buildSystemNoticeMessages(pendingNotices);
      setMessages(fallback);
      void scope.dispatch({ type: "seedLoaded", messages: fallback });
    }
  }, [
    seedStatus,
    refinementId,
    seedQuery.status,
    seedQuery.records,
    pendingNotices,
    scope,
  ]);

  const createWrite = useExternalWrite<
    {
      parentId: string;
      clientId: string;
      snapshotId?: string;
      contextSpec?: ContextSpec;
      window?: TimeWindow;
    },
    { readonly id: string }
  >({
    execute: async (args) =>
      (await createRefinement({ target, ...args })).map((r) => ({ id: r.id })),
    concurrency: "ignore",
  });

  const commitWrite = useExternalWrite<
    { parentId: string; refinementId: string },
    { readonly id: string }
  >({
    execute: (args) => commitRefinement({ target, ...args }),
    concurrency: "ignore",
  });

  const preview = extractPreviewFromMessages(messages);
  const previewReady = extractPreviewReady(messages);
  const hasDraftedLens = extractHasDraftedLens(messages);
  const phase = extractRefinePhase(messages);
  const suggestedName = extractSuggestedNameFromMessages(messages);
  const started = refinementId != null && seedStatus === "ready";
  const creating = createWrite.isPending || seedStatus === "loading";
  const committing = commitWrite.isPending;

  const start = useCallback<RefineSession["start"]>(
    async ({
      parentId: nextParentId,
      prompt,
      snapshotId,
      contextSpec,
      window,
      systemNotices,
    }) => {
      if (scope.state.seedStatus === "loading") return false;
      const newClientId = generateId();
      const outcome = await createWrite.run({
        parentId: nextParentId,
        clientId: newClientId,
        snapshotId,
        contextSpec,
        window,
      });
      if (outcome.status === "ignored") return false;
      if (outcome.status === "error") {
        toast.error("Failed to open refinement", {
          description: outcome.error.message,
        });
        return false;
      }
      setMessages([]);
      await scope.dispatch({
        type: "startSeed",
        parentId: nextParentId,
        clientId: newClientId,
        refinementId: outcome.id,
        firstPrompt: prompt ?? null,
        pendingNotices: systemNotices ?? null,
      });
      return true;
    },
    [createWrite, scope],
  );

  const resume = useCallback<RefineSession["resume"]>(
    (args) => {
      setMessages(args.messages ?? []);
      void scope.dispatch({
        type: "resume",
        parentId: args.parentId,
        clientId: args.clientId,
        refinementId: args.refinementId,
        messages: args.messages,
      });
    },
    [scope],
  );

  const reset = useCallback<RefineSession["reset"]>(() => {
    setMessages([]);
    void scope.dispatch({ type: "reset" });
  }, [scope]);

  const commit = useCallback<RefineSession["commit"]>(
    async (nextParentId) => {
      const currentRefinementId = scope.state.refinementId;
      if (!currentRefinementId) return false;
      const outcome = await commitWrite.run({
        parentId: nextParentId,
        refinementId: currentRefinementId,
      });
      if (outcome.status === "ignored") return false;
      if (outcome.status === "error") {
        toast.error("Failed to commit", {
          description: outcome.error.message,
        });
        return false;
      }
      onCommitted?.(outcome.id);
      return true;
    },
    [commitWrite, scope, onCommitted],
  );

  return {
    target,
    parentId,
    clientId,
    refinementId,
    firstPrompt,
    initialMessages: initialMessages as UIMessage[] | undefined,
    messages,
    onMessagesChange,
    preview,
    previewReady,
    hasDraftedLens,
    phase,
    suggestedName,
    started,
    creating,
    committing,
    start,
    resume,
    reset,
    commit,
  };
}
