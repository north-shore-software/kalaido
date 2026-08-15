import { useChat } from "@ai-sdk/react";
import {
  type ChatTransport,
  generateId,
  type PrepareSendMessagesRequest,
  type UIMessage,
} from "ai";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createKalaidoChatTransport,
  itemsToSpec,
  specKey,
  type WindowSpec,
  windowSpecKey,
} from "@/api/kalaidoscope/chat.ts";
import { isQuotaError, QUOTA_MESSAGE } from "@/api/kalaidoscope/cloud/quota";
import { PaneHeader } from "@/components/layout/page-chrome";
import { recordInferenceRate } from "@/hooks/app-state-actions.ts";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { cn } from "@/lib/css-utils";
import { ChatComposer } from "./chat-composer";
import { ChatMessages, type ChatMessagesProps } from "./chat-messages";
import type { ContextItem } from "./context-picker";

interface ChatPanelProps {
  greeting?: string;
  placeholder?: string;
  /**
   * The active context selection. Whenever it changes between turns, the panel
   * signals the backend by appending a `context_spec` system message to the
   * outgoing message stream (the backend diffs successive specs to build the
   * prompt). See {@link itemsToSpec}.
   */
  context?: ContextItem[];
  /**
   * The active reflection window selection. Like {@link context}, whenever it
   * changes between turns the panel appends a `window_spec` system message to the
   * outgoing stream so the backend can update the reflection's schedule mid-chat.
   * Omit it entirely (projections, plain chat) to opt out.
   */
  windowSpec?: WindowSpec;
  /** AI SDK chat id. Reuse a conversation's client id to resume it server-side. */
  chatId?: string;
  initialMessages?: UIMessage[];
  /**
   * If set on a fresh chat, this message is sent automatically once on mount —
   * used when another page (e.g. Home) starts a conversation with a typed prompt.
   */
  initialPrompt?: string;
  /**
   * Fired when an assistant turn finishes. Receives the full message list
   * including the just-completed assistant turn — callers that only need a
   * refresh signal can ignore the argument.
   */
  onTurnComplete?: (messages: UIMessage[]) => void;
  /**
   * Fired whenever the live message list changes (including mid-stream). Unlike
   * {@link onTurnComplete} this always receives the current messages, so callers
   * that derive UI from the stream (e.g. parsing a refinement's drafted snapshot
   * block for a live preview) get fresh state without stale-closure surprises.
   */
  onMessagesChange?: (messages: UIMessage[]) => void;
  title?: ReactNode;
  /**
   * Controls to attach under each assistant answer (see {@link ChatMessages}).
   * Only the surfaces where an answer is worth keeping supply this — a refine
   * chat's answers are drafts of a snapshot, not material in their own right.
   */
  assistantActions?: ChatMessagesProps["assistantActions"];
  /** Drop the card chrome when embedded in a column that already has a border. */
  flat?: boolean;
  className?: string;
  transport?: ChatTransport<UIMessage>;
}

export function ChatPanel({
  greeting = "Hello! How can I help you today?",
  placeholder = "Message…",
  context,
  windowSpec,
  chatId,
  initialMessages,
  initialPrompt,
  onTurnComplete,
  onMessagesChange,
  title,
  assistantActions,
  flat,
  className,
  transport: transportProp,
}: ChatPanelProps) {
  const client = useKalaidoscopeClient();
  const [input, setInput] = useState("");

  // Whether this panel manages context at all. A caller that omits `context`
  // (e.g. the refine pages) is opting out: the panel must leave the
  // conversation's existing pinned context untouched rather than treating the
  // absence as an empty selection (which itemsToSpec would turn into
  // `wholeScope`, silently resetting the context on the next turn).
  const manageContextRef = useRef(context !== undefined);
  manageContextRef.current = context !== undefined;

  // Read live in the transport so the spec is always current when a turn fires.
  const specRef = useRef(itemsToSpec(context ?? []));
  specRef.current = itemsToSpec(context ?? []);
  // The spec the backend already knows for this conversation. A fresh panel
  // starts empty; switching conversations remounts the panel (keyed on chat id),
  // so we never carry one conversation's baseline into another. We only emit a
  // context_spec when the active spec diverges from this.
  const lastSentSpecRef = useRef(specKey({}));

  // Same machinery for the optional reflection window spec. A caller that omits
  // `windowSpec` opts out (e.g. projections / plain chat); otherwise we emit a
  // `window_spec` part whenever it diverges from the last one sent.
  const manageWindowRef = useRef(windowSpec !== undefined);
  manageWindowRef.current = windowSpec !== undefined;
  const windowSpecRef = useRef(windowSpec);
  windowSpecRef.current = windowSpec;
  const lastSentWindowRef = useRef(windowSpecKey(undefined));

  const [quotaHit, setQuotaHit] = useState(false);

  const transport = useMemo(() => {
    if (transportProp) return transportProp;

    const prepareSendMessagesRequest: PrepareSendMessagesRequest<UIMessage> = ({
      id,
      messages,
      body,
      trigger,
      messageId,
    }) => {
      let outgoing = messages;
      // Collect any spec parts (context and/or window) that changed since the
      // last turn; the backend reads both `context_spec` and `window_spec`
      // parts off the same message.
      const specParts: { type: string; data: unknown }[] = [];

      const ctxKey = specKey(specRef.current);
      if (manageContextRef.current && ctxKey !== lastSentSpecRef.current) {
        specParts.push({ type: "context_spec", data: specRef.current });
        lastSentSpecRef.current = ctxKey;
      }

      const winKey = windowSpecKey(windowSpecRef.current);
      if (manageWindowRef.current && winKey !== lastSentWindowRef.current) {
        specParts.push({ type: "window_spec", data: windowSpecRef.current });
        lastSentWindowRef.current = winKey;
      }

      if (specParts.length > 0) {
        const specMsg = {
          id: generateId(),
          role: "system",
          parts: specParts,
        } as unknown as UIMessage;
        // The spec applies to the turn that follows it, so slot it in just
        // before the user message being sent (or append it on regenerate).
        // The backend persists it before streaming, so it is durably recorded
        // even if the turn fails (e.g. quota) — baselines were advanced above.
        outgoing =
          trigger === "submit-message" && outgoing.length > 0
            ? [...outgoing.slice(0, -1), specMsg, outgoing[outgoing.length - 1]]
            : [...outgoing, specMsg];
      }
      return {
        body: { ...body, id, messages: outgoing, trigger, messageId },
      };
    };

    return createKalaidoChatTransport({
      baseURL: client.baseURL,
      prepareSendMessagesRequest,
    });
  }, [transportProp, client]);

  const { messages, sendMessage, status } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish: () => onTurnComplete?.(messages),
    onError: (err) => {
      // Quota exhaustion has its own dedicated banner (see quotaHit); every other
      // stream failure (provider down, bad model id, 500, network) is surfaced
      // via toast so a failed turn is visible.
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
          recordInferenceRate(rate);
        }
      }
    },
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  const sentInitial = useRef(false);
  useEffect(() => {
    if (sentInitial.current) return;
    if (!initialPrompt?.trim()) return;
    if (messages.length > 0) return;
    sentInitial.current = true;
    sendMessage({ text: initialPrompt });
  }, [initialPrompt, messages.length, sendMessage]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Tigger when messages updates and scroll to the bottom of the relevant DOM element.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  function submit() {
    if (!input.trim() || isLoading || quotaHit) return;
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <div
      className={cn(
        "flex flex-col flex-1 overflow-hidden",
        !flat && "rounded-lg border border-line bg-card",
        className,
      )}
    >
      {title && <PaneHeader label={title} />}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <ChatMessages
          messages={messages}
          greeting={greeting}
          pending={isLoading}
          assistantActions={assistantActions}
        />
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        placeholder={placeholder}
        disabled={isLoading}
        quotaMessage={quotaHit ? QUOTA_MESSAGE : undefined}
      />
    </div>
  );
}
