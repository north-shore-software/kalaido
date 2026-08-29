import { generateId, type UIMessage } from "ai";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ContextSpec } from "@/api/kalaidoscope/chat";
import {
  commitRefinement,
  createRefinement,
  extractPreviewFromMessages,
  extractPreviewReady,
  extractRefinePhase,
  extractSuggestedNameFromMessages,
  normalizeRefinementMessages,
  type RefinePhase,
} from "@/api/kalaidoscope/refinements";

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
  /** AI SDK chat id — pass to {@link ChatPanel}'s `chatId`. */
  clientId: string;
  /** Null until a refinement is opened/adopted; `started` mirrors this. */
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
  /** Where the current turn stands: drafting the lens, applying it, or done. */
  phase: RefinePhase;
  /**
   * The model's latest name suggestion for the document being shaped (empty
   * until one lands). Rides `suggest_name` calls before the first lens and
   * `update_lens`'s `suggested_name` argument afterwards.
   */
  suggestedName: string;
  /** A refinement is open. */
  started: boolean;
  /** A `start` call is in flight. */
  creating: boolean;
  /** A `commit` call is in flight. */
  committing: boolean;
  /**
   * Open a fresh refinement over `parentId`. `prompt` is remembered as the chat's
   * auto-sent first message; `snapshotId` scopes the session to an existing
   * snapshot (its context/window spec seeds the conversation). Returns whether it
   * succeeded (errors are toasted).
   *
   * `contextSpec` opens a session that already has a context — how authoring
   * flows that start from something existing (graduating a fragment, forking a
   * projection) pin their sources up front. Flows that used to seed a draft
   * now pass the material as `prompt` instead: the first turn's lens is what
   * makes the session committable, so the preview stays empty until the model
   * drafts one.
   */
  start: (args: {
    parentId: string;
    prompt?: string;
    snapshotId?: string;
    contextSpec?: ContextSpec;
  }) => Promise<boolean>;
  /** Adopt an already-persisted refinement, seeding the chat with its history. */
  resume: (args: {
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
  const [clientId, setClientId] = useState(() => generateId());
  const [refinementId, setRefinementId] = useState<string | null>(null);
  const [firstPrompt, setFirstPrompt] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<
    UIMessage[] | undefined
  >(undefined);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [creating, setCreating] = useState(false);
  const [committing, setCommitting] = useState(false);

  const onMessagesChange = useCallback((m: UIMessage[]) => setMessages(m), []);

  const preview = extractPreviewFromMessages(messages);
  const previewReady = extractPreviewReady(messages);
  const phase = extractRefinePhase(messages);
  const suggestedName = extractSuggestedNameFromMessages(messages);
  const started = refinementId != null;

  const start = useCallback<RefineSession["start"]>(
    async ({ parentId, prompt, snapshotId, contextSpec }) => {
      if (creating) return false;
      setCreating(true);
      // Mint a fresh chat id per session so re-opening (e.g. re-targeting a new
      // live snapshot) never collides with the previous conversation.
      const newClientId = generateId();
      const res = await createRefinement({
        target,
        parentId,
        clientId: newClientId,
        snapshotId,
        contextSpec,
      });
      setCreating(false);
      if (res.isErr()) {
        toast.error("Failed to open refinement", {
          description: res.error.message,
        });
        return false;
      }
      // Adopt whatever the server seeded (the context system message),
      // normalised into the shape the live stream produces. These carry the
      // server's own message ids, so the next turn recognises them as history
      // rather than persisting a second copy.
      const seeded = res.value.messages ?? [];
      const history = seeded.length
        ? normalizeRefinementMessages(seeded)
        : undefined;
      setClientId(newClientId);
      setInitialMessages(history);
      setMessages(history ?? []);
      setFirstPrompt(prompt ?? null);
      setRefinementId(res.value.refinementId);
      return true;
    },
    [target, creating],
  );

  const resume = useCallback<RefineSession["resume"]>((args) => {
    setClientId(args.clientId);
    setRefinementId(args.refinementId);
    setInitialMessages(args.messages);
    setMessages(args.messages ?? []);
    setFirstPrompt(null);
  }, []);

  const reset = useCallback<RefineSession["reset"]>(() => {
    setClientId(generateId());
    setRefinementId(null);
    setFirstPrompt(null);
    setInitialMessages(undefined);
    setMessages([]);
  }, []);

  const commit = useCallback<RefineSession["commit"]>(
    async (parentId) => {
      if (!refinementId || committing) return false;
      setCommitting(true);
      const res = await commitRefinement({ target, parentId, refinementId });
      setCommitting(false);
      if (res.isErr()) {
        toast.error("Failed to commit", { description: res.error.message });
        return false;
      }
      onCommitted?.(res.value.snapshotId);
      return true;
    },
    [target, refinementId, committing, onCommitted],
  );

  return {
    clientId,
    refinementId,
    firstPrompt,
    initialMessages,
    messages,
    onMessagesChange,
    preview,
    previewReady,
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
