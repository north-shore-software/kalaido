import {
  BookmarkSimpleIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateId, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Conversation,
  getConversationMessages,
  itemsToSpec,
} from "@/api/kalaidoscope/chat.ts";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  ChatPanel,
  type ContextItem,
  PanelErrorBoundary,
} from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
  PaneHeader,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  type BookmarkRow,
  BookmarksTray,
  ChatMessageActions,
  ConversationList,
} from "@/features/explore";
import {
  BookmarkActions,
  type ProjectionStart,
} from "@/features/explore/components/bookmark-actions";
import { useBookmarkActions } from "@/features/explore/hooks/use-bookmark-actions";
import { useBookmarks } from "@/features/explore/hooks/use-bookmarks";
import { useConversations } from "@/features/explore/hooks/use-conversations.ts";
import { useActiveContext } from "@/hooks/use-active-context";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { withContextItem } from "@/lib/mentions";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { exploreTransitions } from "./Explore.transitions";

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

export default function Explore() {
  const client = useKalaidoscopeClient();
  const { go } = useAppNavigate();

  const seed = useAppRouteState<"explore">();
  // The session to pick up where the last visit left off — only read by the
  // one-shot state/ref initialisers below, so it is deliberately not reactive.
  const restored =
    !seed?.initialPrompt && lastExploreSession?.baseURL === client.baseURL
      ? lastExploreSession
      : null;

  const [context, setContext] = useState<ContextItem[]>(
    () => restored?.context ?? [WHOLE_SCOPE_ITEM],
  );
  const initialPromptRef = useRef(seed?.initialPrompt);

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
    go(exploreTransitions.newColourFromBookmarks, {
      state: { seed: { positiveExamples: ids } },
    });
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
    go(exploreTransitions.graduateToProjection, {
      state: {
        seed: {
          name,
          draft: "",
          message,
          contextSpec,
          description: message,
        },
      },
    });
  }

  return (
    <PageLayout>
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
              messageActions={({ message, pending }) => {
                const mark = bookmarks.marks.get(message.id);
                return (
                  <ChatMessageActions
                    bookmarked={!!mark?.bookmarked}
                    fragmentId={mark?.fragmentId}
                    pending={pending}
                    onToggle={(on) => void bookmarks.toggle(message.id, on)}
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
            <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface-1">
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
                selectedClientId={selected?.clientId}
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
    </PageLayout>
  );
}

export const exploreRoute = defineRoute({
  id: "explore",
  path: "/explore",
  aliases: ["/chat"],
  feature: "Explore",
  requiredScope: ["kalaidoscope"],
  transitions: exploreTransitions,
  Component: Explore,
});
