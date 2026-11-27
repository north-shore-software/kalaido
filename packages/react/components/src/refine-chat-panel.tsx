import type { TimeWindow } from "@kalaido/client/kalaidoscope/chat";
import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { forwardRef, type ReactNode } from "react";
import { ChatPanel, type ChatPanelHandle } from "./chat-panel";
import type { ContextItem, EntityKind } from "./context-picker";
import { PanelErrorBoundary } from "./panel-error-boundary";

export interface RefineChatPanelProps {
  session: RefineSession;
  context?: ContextItem[];
  onMention?: (item: ContextItem) => void;
  onContextChange?: (items: ContextItem[]) => void;
  notifyOnContextChange?: boolean;
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
    notifyOnContextChange,
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
  return (
    <PanelErrorBoundary label="the chat" resetKey={session.clientId}>
      <ChatPanel
        ref={ref}
        flat={flat}
        key={session.clientId}
        chat={session.chat}
        input={input}
        onInputChange={onInputChange}
        context={context}
        onMention={onMention}
        onContextChange={onContextChange}
        notifyOnContextChange={notifyOnContextChange}
        entity={entity}
        timeWindow={timeWindow}
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
