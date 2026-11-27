import type {
  ContextSpec,
  TimeWindow,
} from "@kalaido/client/kalaidoscope/chat";
import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import type { KalaidoChatController } from "@kalaido/hooks/use-kalaido-chat";
import { PaneHeader } from "@kalaido/primitives/layout/page-primitives";
import { cn } from "@kalaido/primitives/lib/css-utils";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ChatComposer } from "./chat-composer";
import { ChatMessages, type ChatMessagesProps } from "./chat-messages";
import { ContextBar } from "./context-bar/context-bar";
import { ContextMeter } from "./context-meter/context-meter";
import { usePromptEstimate } from "./context-meter/use-prompt-estimate";
import type { ContextItem, EntityKind } from "./context-picker";

export interface ChatPanelHandle {
  appendSystemNotice: (
    type: string,
    data?: Record<string, unknown>,
    id?: string,
  ) => void;
  focus: () => void;
}

export interface ChatPanelProps {
  /** Caller-owned chat controller from `useKalaidoChat`. */
  chat: KalaidoChatController;
  greeting?: string;
  placeholder?: string;
  /**
   * The active context selection. Whenever it changes between turns, outgoing
   * turns signal the backend by appending a `context_spec` system message.
   * Omit to opt out (leaves the conversation's existing pinned context alone).
   */
  context?: ContextItem[];
  /**
   * Fired when the user @-mentions an entity in the composer. The owner of
   * {@link context} must add the item to the selection. Only meaningful
   * alongside `context`; omit to disable the mention menu.
   */
  onMention?: (item: ContextItem) => void;
  /**
   * Fired when the user edits the context via the {@link ContextBar} rendered
   * above the composer. Without it (alongside `context`) the spec still flows,
   * but no bar renders.
   */
  onContextChange?: (items: ContextItem[]) => void;
  /**
   * When true, editing context via the picker immediately posts the new
   * `context_spec` to the assistant so it responds conversationally.
   */
  notifyOnContextChange?: boolean;
  /** Restricts the bar's pin search (a reflection can only pin fragments). */
  entity?: EntityKind;
  /**
   * The window a reflection refinement targets. Passed to `ContextBar` and
   * forwarded on outgoing user turns. Omit to opt out.
   */
  timeWindow?: TimeWindow;
  title?: ReactNode;
  /** Controls to attach under each chat turn (see {@link ChatMessages}). */
  messageActions?: ChatMessagesProps["messageActions"];
  /** See {@link ChatMessages}: which turns keep their actions visible. */
  actionsVisibleFor?: ChatMessagesProps["actionsVisibleFor"];
  highlightedEditId?: string | null;
  edits?: SnapshotEdit[];
  onUndoEdit?: (editId: string) => void;
  /** Show how full the context window is, beneath the composer. */
  meter?: { conversationId: string };
  /** Drop the card chrome when embedded in a column that already has a border. */
  flat?: boolean;
  className?: string;
  input?: string;
  onInputChange?: (value: string) => void;
  /**
   * Hold the conversation: the composer and context bar stop accepting input
   * while the owner asks something through {@link trailing}. The transcript
   * itself stays readable.
   */
  disabled?: boolean;
  /**
   * Rendered after the last message, inside the scroll area — the page's own
   * question in the stream (see {@link DecisionCard}), as opposed to a turn
   * the model produced.
   */
  trailing?: ReactNode;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel(
    {
      chat,
      greeting = "Hello! How can I help you today?",
      placeholder = "Message…",
      context,
      onMention,
      onContextChange,
      notifyOnContextChange = false,
      entity,
      timeWindow,
      title,
      messageActions,
      actionsVisibleFor,
      highlightedEditId,
      edits,
      onUndoEdit,
      meter,
      flat,
      className,
      input: controlledInput,
      onInputChange,
      disabled = false,
      trailing,
    }: ChatPanelProps,
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [internalInput, setInternalInput] = useState("");
    const input =
      controlledInput !== undefined ? controlledInput : internalInput;
    const setInput = onInputChange ?? setInternalInput;

    const estimate = usePromptEstimate({
      conversationId: meter?.conversationId ?? "",
      items: context ?? [],
      messages: chat.messages,
      streaming: chat.isLoading,
      enabled: meter !== undefined,
    });

    useEffect(() => {
      const el = messagesContainerRef.current;
      if (!el) return;
      if (chat.messages || trailing) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }, [chat.messages, trailing]);

    function submit() {
      if (!input.trim() || chat.isLoading || chat.quotaHit) return;
      chat.sendUserMessage(input, { context, timeWindow });
      setInput("");
    }

    const handleConfirmContext = useCallback(
      (spec: ContextSpec, items: ContextItem[]) => {
        chat.confirmContext(spec);
        onContextChange?.(items);
      },
      [chat, onContextChange],
    );

    const handlePickerContextChange = useCallback(
      (items: ContextItem[]) => {
        onContextChange?.(items);
        if (notifyOnContextChange) {
          chat.notifyContextChange(items);
        }
      },
      [chat, notifyOnContextChange, onContextChange],
    );

    useImperativeHandle(
      ref,
      () => ({
        appendSystemNotice: chat.appendSystemNotice,
        focus: () => {
          textareaRef.current?.focus();
        },
      }),
      [chat.appendSystemNotice],
    );

    return (
      <div
        className={cn(
          "flex flex-col flex-1 overflow-hidden",
          !flat && "rounded-none border border-line bg-card",
          className,
        )}
      >
        {title && <PaneHeader label={title} />}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          <ChatMessages
            messages={chat.messages}
            greeting={greeting}
            pending={chat.isLoading}
            highlightedEditId={highlightedEditId}
            edits={edits}
            onUndoEdit={onUndoEdit}
            onConfirmRegenerate={chat.confirmRegenerate}
            onCancelRegenerate={chat.cancelRegenerate}
            onConfirmFullRewrite={chat.confirmFullRewrite}
            onCancelFullRewrite={chat.cancelFullRewrite}
            onConfirmContext={handleConfirmContext}
            onCancelContext={chat.cancelContext}
            messageActions={messageActions}
            actionsVisibleFor={actionsVisibleFor}
          />
          {trailing}
        </div>

        {context !== undefined && onContextChange && (
          <div inert={disabled}>
            <ContextBar
              items={context}
              onChange={handlePickerContextChange}
              entity={entity}
              timeWindow={timeWindow}
            />
          </div>
        )}

        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={placeholder}
          disabled={chat.isLoading || disabled}
          quotaMessage={chat.quotaMessage}
          onMention={context !== undefined ? onMention : undefined}
          textareaRef={textareaRef}
          footer={
            meter && (
              <ContextMeter
                total={estimate.total}
                limit={estimate.limit}
                model={estimate.model}
                measured={estimate.measured}
              />
            )
          }
        />
      </div>
    );
  },
);
