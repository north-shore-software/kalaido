import {
  type ContextSpec,
  type Conversation,
  getConversationMessages,
  itemsToSpec,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  ChatPanel,
  type ContextItem,
  PageHeader,
  PanelErrorBoundary,
} from "@kalaido/components";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import {
  PageCard,
  PaneHeader,
} from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  BookmarkSimpleIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateId, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkActions, type ProjectionStart } from "./bookmark-actions";
import { type BookmarkRow, BookmarksTray } from "./bookmarks-tray";
import { ChatMessageActions } from "./chat-message-actions";
import { ConversationList } from "./conversation-list";
import { useActiveContext } from "./hooks/use-active-context";
import { useBookmarkActions } from "./hooks/use-bookmark-actions";
import { useBookmarks } from "./hooks/use-bookmarks";
import { useConversations } from "./hooks/use-conversations";

/** The text a turn shows — what a bookmark of it keeps. */
function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((part) => part.type === "text" && part.text?.trim())
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");
}

interface ExploreSessionState {
  baseURL: string;
  selected: {
    id: string;
    clientId: string;
    messages: UIMessage[];
  } | null;
  newChatId: string;
  messages: UIMessage[];
  context: ContextItem[];
}

let lastExploreSession: ExploreSessionState | null = null;

export interface ExploreProjectionSeed {
  name: string;
  draft: string;
  message: string;
  contextSpec: ContextSpec;
  description: string;
}

export interface ExploreScreenProps {
  initialPrompt?: string;
  onNewColourFromBookmarks: (positiveExamples: string[]) => void;
  onGraduateToProjection: (seed: ExploreProjectionSeed) => void;
}

export function ExploreScreen({
  initialPrompt,
  onNewColourFromBookmarks,
  onGraduateToProjection,
}: ExploreScreenProps) {
  const client = useKalaidoscopeClient();

  // The session to pick up where the last visit left off — only read by the
  // one-shot state/ref initialisers below, so it is deliberately not reactive.
  const restored =
    !initialPrompt && lastExploreSession?.baseURL === client.baseURL
      ? lastExploreSession
      : null;

  const [context, setContext] = useState<ContextItem[]>(
    () => restored?.context ?? [WHOLE_SCOPE_ITEM],
  );
  const initialPromptRef = useRef(initialPrompt);

  const [historyOpen, setHistoryOpen] = useState(true);
  const { conversations, loading: loadingList, refresh } = useConversations();
  const [selected, setSelected] = useState<{
    id: string;
    clientId: string;
    messages: UIMessage[];
  } | null>(() => restored?.selected ?? null);
  const [newChatId, setNewChatId] = useState(
    () => restored?.newChatId ?? generateId(),
  );
  const firstChatIdRef = useRef(newChatId);

  const initialMessagesRef = useRef<UIMessage[]>(
    restored ? (restored.selected?.messages ?? restored.messages) : [],
  );

  const { items: historyContext, ready: historyContextReady } =
    useActiveContext(selected?.messages ?? []);
  const [syncedClientId, setSyncedClientId] = useState<string | null>(
    () => restored?.selected?.clientId ?? null,
  );

  useEffect(() => {
    if (
      selected &&
      historyContextReady &&
      syncedClientId !== selected.clientId
    ) {
      setContext(historyContext);
      setSyncedClientId(selected.clientId);
    }
  }, [selected, historyContext, historyContextReady, syncedClientId]);

  async function handleSelect(conv: Conversation) {
    try {
      const messages = await getConversationMessages(client, conv.id);
      setSelected({ id: conv.id, clientId: conv.clientId, messages });
      setLiveMessages(messages);
    } catch (err) {
      console.error(err);
    }
  }

  function handleNew() {
    const nextChatId = generateId();
    initialMessagesRef.current = [];
    setSelected(null);
    setNewChatId(nextChatId);
    setLiveMessages([]);
    setContext([WHOLE_SCOPE_ITEM]);
    setSyncedClientId(null);
    lastExploreSession = {
      baseURL: client.baseURL,
      selected: null,
      newChatId: nextChatId,
      messages: [],
      context: [WHOLE_SCOPE_ITEM],
    };
  }

  const activeClientId = selected?.clientId ?? newChatId;
  const activeChatKey = selected?.id ?? newChatId;

  const bookmarks = useBookmarks(activeClientId);
  const [liveMessages, setLiveMessages] = useState<UIMessage[]>(() =>
    restored ? (restored.selected?.messages ?? restored.messages) : [],
  );

  useEffect(() => {
    lastExploreSession = {
      baseURL: client.baseURL,
      selected: selected ? { ...selected, messages: liveMessages } : null,
      newChatId,
      messages: liveMessages,
      context,
    };
  }, [client.baseURL, selected, newChatId, liveMessages, context]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const bookmarkRows = useMemo<BookmarkRow[]>(
    () =>
      liveMessages.flatMap((msg) => {
        if (msg.role === "system") return [];
        const mark = bookmarks.marks.get(msg.id);
        if (!mark?.bookmarked) return [];
        return [
          {
            messageId: msg.id,
            role: msg.role === "user" ? "user" : "assistant",
            content: messageText(msg),
            fragmentId: mark.fragmentId,
          },
        ];
      }),
    [liveMessages, bookmarks.marks],
  );
  const actions = useBookmarkActions(activeClientId, bookmarks.refresh);

  /**
   * A new colour composed from the gathered turns: saved first, then handed
   * to the Colours page as the positive examples its preview and creation
   * pin.
   */
  async function newColourFromBookmarks() {
    const ids = await actions.saveAll();
    if (!ids || ids.length === 0) return;
    setBookmarksOpen(false);
    onNewColourFromBookmarks(ids);
  }

  /**
   * The projection the session was working towards: its inputs are the
   * saved bookmarks plus whatever the chat had pinned — never the whole
   * scope, which would drown what the person chose — and the brief is its
   * first turn and its description.
   */
  function startProjectionFromBookmarks({
    name,
    message,
    fragmentIds,
  }: ProjectionStart) {
    const pins = itemsToSpec(
      context.filter(
        (it) => it.kind !== "WholeScope" && it.kind !== "Summaries",
      ),
    );
    const contextSpec = {
      ...pins,
      fragmentIds: [...new Set([...(pins.fragmentIds ?? []), ...fragmentIds])],
    };
    setBookmarksOpen(false);
    onGraduateToProjection({
      name,
      draft: "",
      message,
      contextSpec,
      description: message,
    });
  }

  return (
    <>
      <PageHeader
        title="Explore"
        actions={
          <>
            <Button variant="section" onClick={handleNew}>
              <NotePencilIcon />
              New
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={() => setBookmarksOpen(true)}
              disabled={bookmarkRows.length === 0}
            >
              <BookmarkSimpleIcon />
              Bookmarks
              {bookmarkRows.length > 0 && ` · ${bookmarkRows.length}`}
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <ClockCounterClockwiseIcon />
              History
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex flex-1 overflow-hidden">
          <PanelErrorBoundary label="the chat" resetKey={activeChatKey}>
            <ChatPanel
              flat
              key={activeChatKey}
              chatId={activeClientId}
              initialMessages={selected?.messages ?? initialMessagesRef.current}
              initialPrompt={
                selected == null &&
                activeClientId === firstChatIdRef.current &&
                initialMessagesRef.current.length === 0
                  ? initialPromptRef.current
                  : undefined
              }
              context={context}
              onContextChange={setContext}
              entity="chat"
              meter={{ conversationId: activeClientId }}
              onMention={(item) =>
                setContext((prev) => withContextItem(prev, item))
              }
              messageActions={({ message, pending, contentElement }) => {
                const mark = bookmarks.marks.get(message.id);
                return (
                  <ChatMessageActions
                    bookmarked={!!mark?.bookmarked}
                    fragmentId={mark?.fragmentId}
                    pending={pending}
                    onToggle={(on) => void bookmarks.toggle(message.id, on)}
                    contentElement={contentElement}
                  />
                );
              }}
              actionsVisibleFor={(message) => {
                const mark = bookmarks.marks.get(message.id);
                return !!mark?.bookmarked || !!mark?.fragmentId;
              }}
              onMessagesChange={setLiveMessages}
              onTurnComplete={() => {
                refresh();
              }}
            />
          </PanelErrorBoundary>

          {historyOpen && (
            <aside className="flex w-80 shrink-0 min-h-0 flex-col overflow-hidden border-l border-line bg-surface-1">
              <PaneHeader
                label="History"
                status={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setHistoryOpen(false)}
                    aria-label="Close history"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                }
              />
              <ConversationList
                conversations={conversations}
                selectedClientId={activeClientId}
                loading={loadingList}
                onSelect={handleSelect}
              />
            </aside>
          )}
        </div>
      </PageCard>

      <BookmarksTray
        open={bookmarksOpen}
        onOpenChange={setBookmarksOpen}
        rows={bookmarkRows}
        onUnbookmark={(id) => void bookmarks.toggle(id, false)}
        footer={
          <BookmarkActions
            count={bookmarkRows.length}
            savedCount={bookmarkRows.filter((r) => r.fragmentId).length}
            phase={actions.phase}
            error={actions.error}
            onSaveAll={() => void actions.saveAll()}
            onSaveAndColour={(id, name) => void actions.saveAndColour(id, name)}
            onNewColour={() => void newColourFromBookmarks()}
            onBrief={actions.saveAndBrief}
            onStartProjection={startProjectionFromBookmarks}
          />
        }
      />
    </>
  );
}
