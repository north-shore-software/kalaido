import { forwardRef, type ReactNode } from "react";
import type { TimeWindow } from "@/api/kalaidoscope/chat";
import {
  ChatPanel,
  type ChatPanelHandle,
  type ContextItem,
  type EntityKind,
} from "@/components/kalaido";
import type { SnapshotEdit } from "@/api/kalaidoscope/projections";
import type { RefineSession } from "@/hooks/use-refine-session";
import { PanelErrorBoundary } from "./panel-error-boundary";

export interface RefineChatPanelProps {
  session: RefineSession;
  context?: ContextItem[];
  onMention?: (item: ContextItem) => void;
  onContextChange?: (items: ContextItem[]) => void;
  entity?: EntityKind;
  timeWindow?: TimeWindow;
  title?: ReactNode;
  placeholder?: string;
  flat?: boolean;
  input?: string;
  onInputChange?: (value: string) => void;
  highlightedEditId?: string | null;
  edits?: SnapshotEdit[];
  onUndoEdit?: (editId: string) => void;
  /** See {@link ChatPanel}: hold the conversation while the page asks something. */
  disabled?: boolean;
  /** See {@link ChatPanel}: the page's own card after the last message. */
  trailing?: ReactNode;
}

export const RefineChatPanel = forwardRef<
  ChatPanelHandle,
  RefineChatPanelProps
>(function RefineChatPanel(
  {
    session,
    context,
    onMention,
    onContextChange,
    entity,
    title,
    placeholder,
    flat = true,
    timeWindow,
    input,
    onInputChange,
    highlightedEditId,
    edits,
    onUndoEdit,
    disabled,
    trailing,
  }: RefineChatPanelProps,
  ref,
) {
  const api =
    session.parentId && session.refinementId
      ? `/api/${session.target}s/${encodeURIComponent(session.parentId)}/refinements/${encodeURIComponent(session.refinementId)}/chat`
      : undefined;

  return (
    <PanelErrorBoundary label="the chat" resetKey={session.clientId}>
      <ChatPanel
        ref={ref}
        flat={flat}
        key={session.clientId}
        chatId={session.clientId}
        api={api}
        input={input}
        onInputChange={onInputChange}
        initialMessages={session.initialMessages}
        initialPrompt={session.firstPrompt ?? undefined}
        context={context}
        onMention={onMention}
        onContextChange={onContextChange}
        entity={entity}
        timeWindow={timeWindow}
        onMessagesChange={session.onMessagesChange}
        highlightedEditId={highlightedEditId}
        edits={edits}
        onUndoEdit={onUndoEdit}
        title={title}
        placeholder={placeholder}
        disabled={disabled}
        trailing={trailing}
      />
    </PanelErrorBoundary>
  );
});
