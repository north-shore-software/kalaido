import { useChat } from "@ai-sdk/react";
import { type ChatTransport, generateId, type UIMessage } from "ai";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createKalaidoChatTransport,
  itemsToSpec,
  parseActiveContext,
  parseActiveWindow,
  specKey,
  type TimeWindow,
  timeWindowKey,
} from "@/api/kalaidoscope/chat.ts";
import { isQuotaError, QUOTA_MESSAGE } from "@/api/kalaidoscope/cloud/quota";
import { PaneHeader } from "@/components/layout/page-chrome";
import { recordInferenceRate } from "@/hooks/app-state-actions.ts";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { cn } from "@/lib/css-utils";
import { ChatComposer } from "./chat-composer";
import { ChatMessages, type ChatMessagesProps } from "./chat-messages";
import { ContextBar } from "./context-bar/context-bar";
import type { ContextItem, EntityKind } from "./context-picker";

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
   * Fired when the user @-mentions an entity in the composer. The owner of
   * {@link context} must add the item to the selection, so the mention's
   * subject is pinned by the next `context_spec`. Only meaningful alongside
   * `context`; omit to disable the mention menu.
   */
  onMention?: (item: ContextItem) => void;
  /**
   * Fired when the user edits the context via the {@link ContextBar} rendered
   * above the composer. The owner of {@link context} applies the new selection.
   * Without it (alongside `context`) the spec still flows, but no bar renders.
   */
  onContextChange?: (items: ContextItem[]) => void;
  /** Restricts the bar's pin search (a reflection can only pin fragments). */
  entity?: EntityKind;
  /**
   * The window a reflection refinement targets. Like {@link context}, whenever
   * it changes between turns the panel appends a `window` system message to
   * the outgoing stream; the backend re-resolves the context inside it, the
   * next preview is generated for it, and a commit files the snapshot under
   * it. Omit it entirely (projections, plain chat) to opt out.
   */
  timeWindow?: TimeWindow;
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
  onMention,
  onContextChange,
  entity,
  timeWindow,
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
  // The spec the backend already knows for this conversation: seeded from the
  // resumed history's last context_spec (a fresh chat has none and starts
  // empty). Switching conversations remounts the panel (keyed on chat id), so
  // we never carry one conversation's baseline into another. We only emit a
  // context_spec when the active spec diverges from this.
  const lastSentSpecRef = useRef<string | null>(null);
  if (lastSentSpecRef.current === null) {
    lastSentSpecRef.current = specKey(
      parseActiveContext(initialMessages ?? []) ?? {},
    );
  }

  // Same machinery for the optional target window. A caller that omits
  // `timeWindow` opts out (e.g. projections / plain chat); otherwise we emit a
  // `window` part whenever it diverges from the last one sent — the baseline
  // being the window the conversation was seeded/resumed with, so re-opening
  // a session never re-announces its own window.
  const manageWindowRef = useRef(timeWindow !== undefined);
  manageWindowRef.current = timeWindow !== undefined;
  const timeWindowRef = useRef(timeWindow);
  timeWindowRef.current = timeWindow;
  const lastSentWindowRef = useRef<string | null>(null);
  if (lastSentWindowRef.current === null) {
    lastSentWindowRef.current = timeWindowKey(
      parseActiveWindow(initialMessages ?? []),
    );
  }

  const [quotaHit, setQuotaHit] = useState(false);

  const transport = useMemo(() => {
    if (transportProp) return transportProp;
    return createKalaidoChatTransport({ baseURL: client.baseURL });
  }, [transportProp, client]);

  const { messages, sendMessage, status, setMessages } = useChat({
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: appendSpecChanges is intentionally unlisted — the send is a guarded one-shot
  useEffect(() => {
    if (sentInitial.current) return;
    if (!initialPrompt?.trim()) return;
    if (messages.some((m) => m.role !== "system")) return;
    sentInitial.current = true;
    appendSpecChanges();
    sendMessage({ text: initialPrompt });
  }, [initialPrompt, messages, sendMessage]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Tigger when messages updates and scroll to the bottom of the relevant DOM element.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  /**
   * Append any spec change (context and/or window) to the live transcript as a
   * system message before a send, so the transcript the user sees — including
   * the context-change divider it renders — is exactly what goes to the
   * backend and what a resumed conversation loads. `sendMessage` appends the
   * user message after it, and the backend persists the spec message before
   * streaming, so it is durably recorded even if the turn fails (e.g. quota) —
   * matching the baselines, which advance here.
   */
  function appendSpecChanges() {
    const specParts: { type: string; data: unknown }[] = [];

    const ctxKey = specKey(specRef.current);
    if (manageContextRef.current && ctxKey !== lastSentSpecRef.current) {
      specParts.push({ type: "context_spec", data: specRef.current });
      lastSentSpecRef.current = ctxKey;
    }

    const winKey = timeWindowKey(timeWindowRef.current);
    if (
      manageWindowRef.current &&
      timeWindowRef.current &&
      winKey !== lastSentWindowRef.current
    ) {
      const { start, end, id } = timeWindowRef.current;
      specParts.push({ type: "window", data: { start, end, id } });
      lastSentWindowRef.current = winKey;
    }

    if (specParts.length === 0) return;
    const specMsg = {
      id: generateId(),
      role: "system",
      parts: specParts,
    } as unknown as UIMessage;
    setMessages((prev) => [...prev, specMsg]);
  }

  function submit() {
    if (!input.trim() || isLoading || quotaHit) return;
    appendSpecChanges();
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

      {context !== undefined && onContextChange && (
        <ContextBar
          items={context}
          onChange={onContextChange}
          entity={entity}
        />
      )}

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        placeholder={placeholder}
        disabled={isLoading}
        quotaMessage={quotaHit ? QUOTA_MESSAGE : undefined}
        onMention={context !== undefined ? onMention : undefined}
      />
    </div>
  );
}
