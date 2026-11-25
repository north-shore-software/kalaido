import { Chat, useChat } from "@ai-sdk/react";
import {
  CONTEXT_CANCEL_PART_TYPE,
  CONTEXT_CONFIRM_PART_TYPE,
  type ContextItem,
  type ContextSpec,
  createKalaidoChatTransport,
  itemsToSpec,
  parseActiveContext,
  parseActiveWindow,
  REGENERATE_CANCEL_PART_TYPE,
  REGENERATE_CONFIRM_PART_TYPE,
  specKey,
  type TimeWindow,
  timeWindowKey,
} from "@kalaido/client/kalaidoscope/chat";
import {
  isQuotaError,
  QUOTA_MESSAGE,
} from "@kalaido/client/kalaidoscope/cloud/quota";
import { emitInferenceRate } from "@kalaido/client/lib/inference-rate";
import {
  type ChatStatus,
  type ChatTransport,
  generateId,
  type UIMessage,
} from "ai";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useKalaidoscopeClient } from "#use-kalaidoscope-client";
import { useSyncRef } from "#use-sync-ref";

export interface UseKalaidoChatOptions {
  /** AI SDK chat id. Changing `chatId` resets the session to `initialMessages`. */
  chatId?: string;
  /** Custom chat endpoint path (defaults to `/api/chat`). */
  api?: string;
  /** Optional custom transport (primarily for tests). */
  transport?: ChatTransport<UIMessage>;
  /** Initial persisted or seeded transcript for this `chatId`. */
  initialMessages?: UIMessage[];
  /**
   * Active context selection for outgoing turns. Omit to opt out of managing
   * `context_spec` (leaves the conversation's existing context untouched).
   */
  context?: ContextItem[];
  /**
   * Optional target window (reflection refinements). Omit to opt out of
   * managing `window` parts.
   */
  timeWindow?: TimeWindow;
  /** Fired when an assistant turn finishes, receiving the completed transcript. */
  onTurnComplete?: (messages: UIMessage[]) => void;
}

export interface SendMessageOverrides {
  context?: ContextItem[];
  timeWindow?: TimeWindow;
}

export interface OpenAndSendOptions {
  chatId: string;
  api?: string;
  initialMessages?: UIMessage[];
  prompt?: string;
  context?: ContextItem[];
  timeWindow?: TimeWindow;
}

export interface KalaidoChatController {
  readonly chatId: string | undefined;
  readonly messages: UIMessage[];
  readonly status: ChatStatus;
  readonly isLoading: boolean;
  readonly quotaHit: boolean;
  readonly quotaMessage: string | undefined;
  sendUserMessage: (text: string, overrides?: SendMessageOverrides) => void;
  /**
   * Imperatively open a new `Chat` instance for `chatId` (seeded with
   * `initialMessages`) and optionally send `prompt` immediately — without
   * waiting for a render + `useEffect` round-trip.
   */
  openAndSend: (options: OpenAndSendOptions) => void;
  applyTimeWindow: (nextWindow: TimeWindow) => void;
  appendSystemNotice: (
    type: string,
    data?: Record<string, unknown>,
    id?: string,
  ) => void;
  confirmRegenerate: () => void;
  cancelRegenerate: () => void;
  confirmContext: (spec: ContextSpec) => void;
  cancelContext: () => void;
}

function makeSystemMessage(
  parts: Record<string, unknown>[],
  id?: string,
): UIMessage {
  return {
    id: id ?? generateId(),
    role: "system",
    parts,
  } as unknown as UIMessage;
}

function seedBaselines(initialMessages: UIMessage[] | undefined) {
  const msgs = initialMessages ?? [];
  return {
    spec: specKey(parseActiveContext(msgs) ?? {}),
    window: timeWindowKey(parseActiveWindow(msgs)),
  };
}

function buildSpecDiffParts(
  effectiveContext: ContextItem[] | undefined,
  effectiveWindow: TimeWindow | undefined,
  baselines: { spec: string | null; window: string | null },
): {
  parts: Record<string, unknown>[];
  nextSpec: string | null;
  nextWindow: string | null;
} {
  const parts: Record<string, unknown>[] = [];
  let nextSpec = baselines.spec;
  let nextWindow = baselines.window;

  if (effectiveContext !== undefined) {
    const spec = itemsToSpec(effectiveContext);
    const ctxKey = specKey(spec);
    if (ctxKey !== nextSpec) {
      parts.push({ type: "context_spec", data: spec });
      nextSpec = ctxKey;
    }
  }

  if (effectiveWindow !== undefined) {
    const winKey = timeWindowKey(effectiveWindow);
    if (winKey !== nextWindow) {
      const { start, end, id } = effectiveWindow;
      parts.push({ type: "window", data: { start, end, id } });
      nextWindow = winKey;
    }
  }

  return { parts, nextSpec, nextWindow };
}

interface KalaidoChatLatest {
  context: ContextItem[] | undefined;
  timeWindow: TimeWindow | undefined;
  onTurnComplete: ((messages: UIMessage[]) => void) | undefined;
  quotaHit: boolean;
  messages: UIMessage[];
  isLoading: boolean;
  sendMessage: (message?: { text: string }) => void;
  appendSpecChanges: (overrides?: SendMessageOverrides) => void;
  createChatInstance: (
    nextId: string | undefined,
    nextMessages: UIMessage[] | undefined,
    nextApi: string | undefined,
  ) => Chat<UIMessage>;
}

/**
 * Caller-owned chat controller wrapping AI SDK `Chat` + `useChat`, Kalaido's
 * transport, quota/telemetry handling, and diffed `context_spec` / `window`
 * emission.
 *
 * Callers read `chat.messages` directly from `useChat`'s `useSyncExternalStore`
 * snapshot — eliminating child-to-parent `onMessagesChange` effects and
 * reactive send effects inside `ChatPanel` and `useRefineSession`.
 */
export function useKalaidoChat({
  chatId,
  api,
  transport: transportProp,
  initialMessages,
  context,
  timeWindow,
  onTurnComplete,
}: UseKalaidoChatOptions): KalaidoChatController {
  const client = useKalaidoscopeClient();

  const lastSentSpecRef = useRef<string | null>(null);
  const lastSentWindowRef = useRef<string | null>(null);
  const seededForIdRef = useRef<string | undefined | null>(null);
  const pendingWindowResendRef = useRef<TimeWindow | null>(null);

  function createChatInstance(
    nextId: string | undefined,
    nextMessages: UIMessage[] | undefined,
    nextApi: string | undefined,
  ): Chat<UIMessage> {
    const transport =
      transportProp ??
      createKalaidoChatTransport({ baseURL: client.baseURL, api: nextApi });
    return new Chat<UIMessage>({
      id: nextId,
      messages: nextMessages,
      transport,
      onFinish: ({ messages: finishedMessages }) => {
        latestRef.current.onTurnComplete?.(finishedMessages);
        const queuedWindow = pendingWindowResendRef.current;
        if (!queuedWindow) return;
        pendingWindowResendRef.current = null;
        if (latestRef.current.quotaHit) return;
        if (timeWindowKey(queuedWindow) === lastSentWindowRef.current) return;
        if (!finishedMessages.some((m) => m.role === "assistant")) return;
        latestRef.current.appendSpecChanges({ timeWindow: queuedWindow });
        latestRef.current.sendMessage();
      },
      onError: (err) => {
        if (isQuotaError(err)) {
          setQuotaHit(true);
          return;
        }
        toast.error("Chat failed", { description: err.message });
      },
      onData: (dataPart) => {
        if (dataPart.type === "data-inference_rate") {
          const rate = (dataPart.data as { tokensPerSecond?: number })
            ?.tokensPerSecond;
          if (rate) {
            emitInferenceRate(rate);
          }
        }
      },
    });
  }

  const [prevChatId, setPrevChatId] = useState(chatId);
  const [quotaHit, setQuotaHit] = useState(false);
  const [activeChat, setActiveChat] = useState<Chat<UIMessage>>(() =>
    createChatInstance(chatId, initialMessages, api),
  );

  if (chatId !== prevChatId) {
    setPrevChatId(chatId);
    setQuotaHit(false);
    setActiveChat(createChatInstance(chatId, initialMessages, api));
  }

  const { messages, sendMessage, status, setMessages } = useChat({
    chat: activeChat,
  });

  const isLoading = status === "submitted" || status === "streaming";

  const appendSpecChanges = useCallback(
    (overrides?: SendMessageOverrides) => {
      const effectiveContext =
        overrides && "context" in overrides
          ? overrides.context
          : latestRef.current.context;
      const effectiveWindow =
        overrides && "timeWindow" in overrides
          ? overrides.timeWindow
          : latestRef.current.timeWindow;

      const { parts, nextSpec, nextWindow } = buildSpecDiffParts(
        effectiveContext,
        effectiveWindow,
        {
          spec: lastSentSpecRef.current,
          window: lastSentWindowRef.current,
        },
      );
      lastSentSpecRef.current = nextSpec;
      lastSentWindowRef.current = nextWindow;

      if (parts.length === 0) return;
      const specMsg = makeSystemMessage(parts);
      setMessages((prev) => [...prev, specMsg]);
    },
    [setMessages],
  );

  const latestRef = useRef<KalaidoChatLatest>({
    context,
    timeWindow,
    onTurnComplete,
    quotaHit,
    messages,
    isLoading,
    sendMessage,
    appendSpecChanges,
    createChatInstance,
  });
  useSyncRef(latestRef, {
    context,
    timeWindow,
    onTurnComplete,
    quotaHit,
    messages,
    isLoading,
    sendMessage,
    appendSpecChanges,
    createChatInstance,
  });

  useLayoutEffect(() => {
    const key = chatId ?? "";
    if (seededForIdRef.current === key) return;
    seededForIdRef.current = key;
    const baseline = seedBaselines(initialMessages);
    lastSentSpecRef.current = baseline.spec;
    lastSentWindowRef.current = baseline.window;
    pendingWindowResendRef.current = null;
  }, [chatId, initialMessages]);

  const sendUserMessage = useCallback(
    (text: string, overrides?: SendMessageOverrides) => {
      if (
        !text.trim() ||
        latestRef.current.isLoading ||
        latestRef.current.quotaHit
      )
        return;
      appendSpecChanges(overrides);
      void sendMessage({ text });
    },
    [appendSpecChanges, sendMessage],
  );

  const openAndSend = useCallback(
    ({
      chatId: nextChatId,
      api: nextApi,
      initialMessages: nextInitialMessages,
      prompt,
      context: nextContext,
      timeWindow: nextWindow,
    }: OpenAndSendOptions) => {
      const nextChat = latestRef.current.createChatInstance(
        nextChatId,
        nextInitialMessages,
        nextApi,
      );
      const baseline = seedBaselines(nextInitialMessages);
      seededForIdRef.current = nextChatId;
      lastSentSpecRef.current = baseline.spec;
      lastSentWindowRef.current = baseline.window;
      pendingWindowResendRef.current = null;

      setPrevChatId(nextChatId);
      setQuotaHit(false);
      setActiveChat(nextChat);

      const trimmedPrompt = prompt?.trim();
      if (trimmedPrompt) {
        const {
          parts,
          nextSpec,
          nextWindow: updatedWindow,
        } = buildSpecDiffParts(nextContext, nextWindow, baseline);
        lastSentSpecRef.current = nextSpec;
        lastSentWindowRef.current = updatedWindow;
        if (parts.length > 0) {
          nextChat.messages = [...nextChat.messages, makeSystemMessage(parts)];
        }
        void nextChat.sendMessage({ text: trimmedPrompt });
      }
    },
    [],
  );

  const applyTimeWindow = useCallback(
    (nextWindow: TimeWindow) => {
      latestRef.current.timeWindow = nextWindow;
      if (latestRef.current.quotaHit) return;
      if (timeWindowKey(nextWindow) === lastSentWindowRef.current) return;
      if (latestRef.current.isLoading) {
        pendingWindowResendRef.current = nextWindow;
        return;
      }
      if (!latestRef.current.messages.some((m) => m.role === "assistant"))
        return;
      appendSpecChanges({ timeWindow: nextWindow });
      void sendMessage();
    },
    [appendSpecChanges, sendMessage],
  );

  const appendSystemNotice = useCallback(
    (type: string, data?: Record<string, unknown>, id?: string) => {
      const part: Record<string, unknown> = { type, text: "" };
      if (data !== undefined) {
        part.data = data;
      }
      setMessages((prev) => [...prev, makeSystemMessage([part], id)]);
    },
    [setMessages],
  );

  const confirmRegenerate = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      makeSystemMessage([{ type: REGENERATE_CONFIRM_PART_TYPE }]),
    ]);
    void sendMessage();
  }, [sendMessage, setMessages]);

  const cancelRegenerate = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      makeSystemMessage([
        {
          type: REGENERATE_CANCEL_PART_TYPE,
          text: "The user cancelled the requested document regeneration.",
        },
      ]),
    ]);
    void sendMessage();
  }, [sendMessage, setMessages]);

  const confirmContext = useCallback(
    (spec: ContextSpec) => {
      lastSentSpecRef.current = specKey(spec);
      setMessages((prev) => [
        ...prev,
        makeSystemMessage([
          { type: "context_spec", data: spec },
          { type: CONTEXT_CONFIRM_PART_TYPE },
        ]),
      ]);
      void sendMessage();
    },
    [sendMessage, setMessages],
  );

  const cancelContext = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      makeSystemMessage([{ type: CONTEXT_CANCEL_PART_TYPE }]),
    ]);
    void sendMessage();
  }, [sendMessage, setMessages]);

  return useMemo<KalaidoChatController>(
    () => ({
      chatId,
      messages,
      status,
      isLoading,
      quotaHit,
      quotaMessage: quotaHit ? QUOTA_MESSAGE : undefined,
      sendUserMessage,
      openAndSend,
      applyTimeWindow,
      appendSystemNotice,
      confirmRegenerate,
      cancelRegenerate,
      confirmContext,
      cancelContext,
    }),
    [
      chatId,
      messages,
      status,
      isLoading,
      quotaHit,
      sendUserMessage,
      openAndSend,
      applyTimeWindow,
      appendSystemNotice,
      confirmRegenerate,
      cancelRegenerate,
      confirmContext,
      cancelContext,
    ],
  );
}
