import type { ReactNode } from "react";
import type { WindowSpec } from "@/api/kalaidoscope/chat";
import type { RefineSession } from "@/hooks/use-refine-session";
import { ChatPanel, type ContextItem, type EntityKind } from "@/components/kalaido";

/**
 * A {@link ChatPanel} bound to a {@link RefineSession}. Every "refine via chat"
 * surface (New Projection, Projection Review, the reflection detail panel, resuming
 * an uncommitted draft) needs the same cluster of session-derived props wired
 * together — and getting the set wrong is silent: omit `initialMessages` (or the
 * `key`) and a *resumed* session renders an empty chat while its draft preview
 * still populates, so the history looks lost. Binding them here once makes that
 * class of bug unrepresentable at the call site.
 *
 * The `key={session.clientId}` forces a fresh chat instance whenever the session
 * re-targets (a new `start`/`resume` mints a new client id), so seeded
 * `initialMessages` actually take.
 */
export function RefineChatPanel({
  session,
  context,
  onMention,
  onContextChange,
  entity,
  title,
  placeholder,
  flat = true,
  windowSpec,
}: {
  session: RefineSession;
  /** Active context selection; omit to leave the conversation's pinned context untouched. */
  context?: ContextItem[];
  /** See {@link ChatPanel}'s onMention — the owner of `context` adds the mentioned item. */
  onMention?: (item: ContextItem) => void;
  /** See {@link ChatPanel}'s onContextChange — enables the ContextBar above the composer. */
  onContextChange?: (items: ContextItem[]) => void;
  /** See {@link ChatPanel}'s entity — restricts the bar's pin search. */
  entity?: EntityKind;
  windowSpec?: WindowSpec;
  title?: ReactNode;
  placeholder?: string;
  flat?: boolean;
}) {
  return (
    <ChatPanel
      flat={flat}
      key={session.clientId}
      chatId={session.clientId}
      initialMessages={session.initialMessages}
      initialPrompt={session.firstPrompt ?? undefined}
      context={context}
      onMention={onMention}
      onContextChange={onContextChange}
      entity={entity}
      windowSpec={windowSpec}
      onMessagesChange={session.onMessagesChange}
      title={title}
      placeholder={placeholder}
    />
  );
}
