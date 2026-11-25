import type {
  ContextItem,
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
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type KalaidoChatController, useKalaidoChat } from "#use-kalaido-chat";
import { useKalaidoscopeClient } from "#use-kalaidoscope-client";

export interface RefineSystemNotice {
  type: string;
  text?: string;
  data?: Record<string, unknown>;
  id?: string;
}

export interface ResumedRefinementSeed {
  readonly parentId?: string;
  readonly clientId: string;
  readonly refinementId: string;
  readonly messages: UIMessage[];
}

interface RefineControlState {
  parentId: string | null;
  clientId: string;
  refinementId: string | null;
  initialMessages: UIMessage[] | undefined;
  starting: boolean;
}

type RefineControlEvent =
  | { readonly type: "setStarting"; readonly starting: boolean }
  | {
      readonly type: "started";
      readonly parentId: string;
      readonly clientId: string;
      readonly refinementId: string;
      readonly messages: UIMessage[];
    }
  | { readonly type: "reset" };

interface ResolvedRefineIdentity {
  readonly parentId: string | null;
  readonly clientId: string;
  readonly refinementId: string | null;
  readonly initialMessages: UIMessage[] | undefined;
  readonly started: boolean;
  readonly api: string | undefined;
}

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

function buildRefineApi(
  target: "projection" | "reflection",
  parentId: string | null,
  refinementId: string | null,
): string | undefined {
  if (!parentId || !refinementId) return undefined;
  return `/api/${target}s/${encodeURIComponent(parentId)}/refinements/${encodeURIComponent(refinementId)}/chat`;
}

function resolveRefineIdentity(
  target: "projection" | "reflection",
  control: RefineControlState,
  resumed: ResumedRefinementSeed | null | undefined,
): ResolvedRefineIdentity {
  if (control.refinementId !== null) {
    return {
      parentId: control.parentId,
      clientId: control.clientId,
      refinementId: control.refinementId,
      initialMessages: control.initialMessages,
      started: true,
      api: buildRefineApi(target, control.parentId, control.refinementId),
    };
  }
  if (resumed) {
    const parentId = resumed.parentId ?? null;
    return {
      parentId,
      clientId: resumed.clientId,
      refinementId: resumed.refinementId,
      initialMessages: resumed.messages,
      started: true,
      api: buildRefineApi(target, parentId, resumed.refinementId),
    };
  }
  return {
    parentId: null,
    clientId: control.clientId,
    refinementId: null,
    initialMessages: undefined,
    started: false,
    api: undefined,
  };
}

/**
 * The shared lifecycle of a "refine via chat" session, used by every surface
 * that drafts a projection/reflection through {@link ChatPanel}: New Projection,
 * New Reflection, Projection Review, the reflection detail panel, and resuming an
 * uncommitted draft. Owns the chat controller (`useKalaidoChat`), live message
 * stream, drafted-snapshot preview, and committing.
 */
export interface RefineSession {
  /** Target entity type being refined. */
  target: "projection" | "reflection";
  /** Parent entity id if known. */
  parentId: string | null;
  /** AI SDK chat id. */
  clientId: string;
  /** Null until a refinement is opened/adopted; `started` mirrors readiness. */
  refinementId: string | null;
  /** Live chat controller passed directly to {@link RefineChatPanel}. */
  chat: KalaidoChatController;
  /** Live message list (mid-stream included) from `chat.messages`. */
  messages: UIMessage[];
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
   * Open a fresh refinement over `parentId`. `prompt` is sent immediately once
   * seeded history finishes loading; `context` (when provided) emits a
   * `context_spec` before that first turn if it differs from the seeded
   * baseline.
   */
  start: (args: {
    parentId: string;
    prompt?: string;
    snapshotId?: string;
    contextSpec?: ContextSpec;
    context?: ContextItem[];
    window?: TimeWindow;
    systemNotices?: RefineSystemNotice[];
  }) => Promise<boolean>;
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
  resumed,
  onCommitted,
}: {
  target: "projection" | "reflection";
  /** Declarative resumed refinement seed (takes effect until `start()` runs). */
  resumed?: ResumedRefinementSeed | null;
  onCommitted?: (snapshotId: string) => void;
}): RefineSession {
  const client = useKalaidoscopeClient();
  const [idleChatId] = useState(() => generateId());

  const handlers: ScopeHandlers<RefineControlState, RefineControlEvent> = {
    setStarting: (s, e) => {
      s.starting = e.starting;
    },
    started: (s, e) => {
      s.parentId = e.parentId;
      s.clientId = e.clientId;
      s.refinementId = e.refinementId;
      s.initialMessages = e.messages.length ? e.messages : undefined;
      s.starting = false;
    },
    reset: (s) => {
      s.clientId = generateId();
      s.parentId = null;
      s.refinementId = null;
      s.initialMessages = undefined;
      s.starting = false;
    },
  };
  const scope = useScope({
    initial: (): RefineControlState => ({
      parentId: null,
      clientId: generateId(),
      refinementId: null,
      initialMessages: undefined,
      starting: false,
    }),
    handlers,
  });

  const control = useScopeState(scope) as RefineControlState;
  const identity = resolveRefineIdentity(target, control, resumed);

  const identityRef = useRef(identity);
  useLayoutEffect(() => {
    identityRef.current = identity;
  });

  const chat = useKalaidoChat({
    chatId: identity.started ? identity.clientId : idleChatId,
    api: identity.api,
    initialMessages: identity.started ? identity.initialMessages : undefined,
  });

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

  const messages = chat.messages;
  const preview = extractPreviewFromMessages(messages);
  const previewReady = extractPreviewReady(messages);
  const hasDraftedLens = extractHasDraftedLens(messages);
  const phase = extractRefinePhase(messages);
  const suggestedName = extractSuggestedNameFromMessages(messages);
  const creating = createWrite.isPending || control.starting;
  const committing = commitWrite.isPending;

  const { openAndSend } = chat;
  const start = useCallback<RefineSession["start"]>(
    async ({
      parentId: nextParentId,
      prompt,
      snapshotId,
      contextSpec,
      context,
      window,
      systemNotices,
    }) => {
      if (scope.state.starting) return false;
      const newClientId = generateId();
      await scope.dispatch({ type: "setStarting", starting: true });
      try {
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

        const fkField =
          target === "projection"
            ? "projection_refinement_id"
            : "reflection_refinement_id";
        let seeded: UIMessage[] = [];
        try {
          const records = await client.collection("chat_message").getFullList({
            filter: client.filter(`${fkField} = {:id}`, { id: outcome.id }),
            sort: "created",
            requestKey: null,
          });
          const raw = records
            .map((r) => r.content as UIMessage | null)
            .filter((m): m is UIMessage => m != null);
          seeded = raw.length ? [...normalizeRefinementMessages(raw)] : [];
        } catch {
          // Proceed with system notices only if the one-shot seed read fails.
        }
        const history: UIMessage[] = [
          ...seeded,
          ...buildSystemNoticeMessages(systemNotices ?? null),
        ];

        openAndSend({
          chatId: newClientId,
          api: buildRefineApi(target, nextParentId, outcome.id),
          initialMessages: history.length ? history : undefined,
          prompt,
          context,
        });

        await scope.dispatch({
          type: "started",
          parentId: nextParentId,
          clientId: newClientId,
          refinementId: outcome.id,
          messages: history,
        });
        return true;
      } finally {
        await scope.dispatch({ type: "setStarting", starting: false });
      }
    },
    [client, createWrite, openAndSend, scope, target],
  );

  const reset = useCallback<RefineSession["reset"]>(() => {
    void scope.dispatch({ type: "reset" });
  }, [scope]);

  const commit = useCallback<RefineSession["commit"]>(
    async (nextParentId) => {
      const currentRefinementId = identityRef.current.refinementId;
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
    [commitWrite, onCommitted],
  );

  return {
    target,
    parentId: identity.parentId,
    clientId: identity.clientId,
    refinementId: identity.refinementId,
    chat,
    messages,
    preview,
    previewReady,
    hasDraftedLens,
    phase,
    suggestedName,
    started: identity.started,
    creating,
    committing,
    start,
    reset,
    commit,
  };
}
