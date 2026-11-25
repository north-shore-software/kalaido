import {
  type ContextSpec,
  type Conversation,
  getConversationMessages,
  itemsToSpec,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import {
  ChatPanel,
  type ContextItem,
  PageHeader,
  PanelErrorBoundary,
} from "@kalaido/components";
import { kalaidoscopeEndpointTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoChat } from "@kalaido/hooks/use-kalaido-chat";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import {
  PageCard,
  PaneHeader,
} from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { invalidateLiveTags } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import {
  BookmarkSimpleIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateId, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookmarkActions, type ProjectionStart } from "./bookmark-actions";
import { type BookmarkRow, BookmarksTray } from "./bookmarks-tray";
import { ChatMessageActions } from "./chat-message-actions";
import { ConversationList } from "./conversation-list";
import { useActiveContext } from "./hooks/use-active-context";
import { useBookmarkActions } from "./hooks/use-bookmark-actions";
import { useBookmarks } from "./hooks/use-bookmarks";
import { useChatContextSelection } from "./hooks/use-chat-context-selection";
import {
  CHAT_CONVERSATIONS_ENDPOINT,
  useConversations,
} from "./hooks/use-conversations";

/** The text a turn shows — what a bookmark of it keeps. */
function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((part) => part.type === "text" && part.text?.trim())
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");
}

interface SelectedConversation {
  id: string;
  clientId: string;
  messages: UIMessage[];
}

interface ExploreWorkflowState {
  selected: SelectedConversation | null;
  newChatId: string;
  context: ContextItem[];
  syncedClientId: string | null;
  historyOpen: boolean;
  bookmarksOpen: boolean;
}

type ExploreWorkflowEvent =
  | {
      readonly type: "selectConversation";
      readonly conversation: SelectedConversation;
    }
  | { readonly type: "startNew"; readonly nextChatId: string }
  | { readonly type: "setContext"; readonly context: ContextItem[] }
  | {
      readonly type: "syncHistoryContext";
      readonly clientId: string;
      readonly context: ContextItem[];
    }
  | { readonly type: "setHistoryOpen"; readonly open: boolean }
  | { readonly type: "toggleHistory" }
  | { readonly type: "setBookmarksOpen"; readonly open: boolean };

export interface ExploreProjectionSeed {
  name: string;
  draft: string;
  message: string;
  contextSpec: ContextSpec;
  description: string;
}

export interface ExploreScreenProps {
  initialPrompt?: string;
  /** Most recent conversation id for this workspace, handed down from root app state. */
  recentConversationId?: string | null;
  onRecentConversationChange?: (conversationId: string | null) => void;
  onNewColourFromBookmarks: (positiveExamples: string[]) => void;
  onGraduateToProjection: (seed: ExploreProjectionSeed) => void;
}

export function ExploreScreen({
  initialPrompt,
  recentConversationId,
  onRecentConversationChange,
  onNewColourFromBookmarks,
  onGraduateToProjection,
}: ExploreScreenProps) {
  const client = useKalaidoscopeClient();
  const [capturedInitialPrompt] = useState(() => initialPrompt);
  const [firstChatId] = useState(() => generateId());

  const handlers: ScopeHandlers<ExploreWorkflowState, ExploreWorkflowEvent> = {
    selectConversation: (s, e) => {
      s.selected = e.conversation;
    },
    startNew: (s, e) => {
      s.selected = null;
      s.newChatId = e.nextChatId;
      s.context = [WHOLE_SCOPE_ITEM];
      s.syncedClientId = null;
    },
    setContext: (s, e) => {
      s.context = e.context;
    },
    syncHistoryContext: (s, e) => {
      s.context = e.context;
      s.syncedClientId = e.clientId;
    },
    setHistoryOpen: (s, e) => {
      s.historyOpen = e.open;
    },
    toggleHistory: (s) => {
      s.historyOpen = !s.historyOpen;
    },
    setBookmarksOpen: (s, e) => {
      s.bookmarksOpen = e.open;
    },
  };
  const scope = useScope({
    initial: (): ExploreWorkflowState => ({
      selected: null,
      newChatId: firstChatId,
      context: [WHOLE_SCOPE_ITEM],
      syncedClientId: null,
      historyOpen: true,
      bookmarksOpen: false,
    }),
    handlers,
  });

  const {
    selected,
    newChatId,
    context,
    syncedClientId,
    historyOpen,
    bookmarksOpen,
  } = useScopeState(scope);

  const handleContextChange = useCallback(
    (next: ContextItem[]) => {
      void scope.dispatch({ type: "setContext", context: next });
    },
    [scope],
  );
  const { context: effectiveContext, mentionContext } = useChatContextSelection(
    context,
    handleContextChange,
  );

  const { conversations, loading: loadingList } = useConversations();

  // One-shot restore of the workspace's most recent persisted conversation on
  // mount (skipped when arriving with an explicit `initialPrompt`).
  const restoredRecentRef = useRef(false);
  useEffect(() => {
    if (
      restoredRecentRef.current ||
      capturedInitialPrompt ||
      !recentConversationId ||
      loadingList
    ) {
      return;
    }
    const target = conversations.find(
      (c) =>
        c.clientId === recentConversationId || c.id === recentConversationId,
    );
    restoredRecentRef.current = true;
    if (!target) return;
    let cancelled = false;
    void getConversationMessages(client, target.id)
      .then((messages) => {
        if (cancelled) return;
        void scope.dispatch({
          type: "selectConversation",
          conversation: { id: target.id, clientId: target.clientId, messages },
        });
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [
    capturedInitialPrompt,
    recentConversationId,
    loadingList,
    conversations,
    client,
    scope,
  ]);

  const selectedMessages = (selected?.messages ?? []) as UIMessage[];
  const { items: historyContext, ready: historyContextReady } =
    useActiveContext(selectedMessages);

  useEffect(() => {
    if (
      selected &&
      historyContextReady &&
      syncedClientId !== selected.clientId
    ) {
      void scope.dispatch({
        type: "syncHistoryContext",
        clientId: selected.clientId,
        context: historyContext,
      });
    }
  }, [selected, historyContext, historyContextReady, syncedClientId, scope]);

  const handleSelect = useCallback(
    async (conv: Conversation) => {
      restoredRecentRef.current = true;
      try {
        const messages = await getConversationMessages(client, conv.id);
        await scope.dispatch({
          type: "selectConversation",
          conversation: { id: conv.id, clientId: conv.clientId, messages },
        });
        onRecentConversationChange?.(conv.clientId);
      } catch (err) {
        console.error(err);
      }
    },
    [client, scope, onRecentConversationChange],
  );

  function handleNew() {
    restoredRecentRef.current = true;
    void scope.dispatch({ type: "startNew", nextChatId: generateId() });
    onRecentConversationChange?.(null);
  }

  const activeClientId = selected?.clientId ?? newChatId;
  const activeChatKey = selected?.id ?? newChatId;

  const chat = useKalaidoChat({
    chatId: activeClientId,
    initialMessages: selectedMessages,
    context: effectiveContext,
    onTurnComplete: () => {
      onRecentConversationChange?.(activeClientId);
      void invalidateLiveTags([
        kalaidoscopeEndpointTag(client.baseURL, CHAT_CONVERSATIONS_ENDPOINT),
      ]);
    },
  });

  const sentInitialPromptRef = useRef(false);
  const { sendUserMessage } = chat;
  useEffect(() => {
    if (sentInitialPromptRef.current) return;
    const prompt = capturedInitialPrompt?.trim();
    if (!prompt) return;
    sentInitialPromptRef.current = true;
    sendUserMessage(prompt);
  }, [capturedInitialPrompt, sendUserMessage]);

  const bookmarks = useBookmarks(activeClientId);
  const bookmarkRows = useMemo<BookmarkRow[]>(
    () =>
      chat.messages.flatMap((msg) => {
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
    [chat.messages, bookmarks.marks],
  );
  const actions = useBookmarkActions(activeClientId, bookmarks.marks);

  /**
   * A new colour composed from the gathered turns: saved first, then handed
   * to the Colours page as the positive examples its preview and creation
   * pin.
   */
  async function newColourFromBookmarks() {
    const ids = await actions.saveAll();
    if (!ids || ids.length === 0) return;
    void scope.dispatch({ type: "setBookmarksOpen", open: false });
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
      effectiveContext.filter(
        (it) => it.kind !== "WholeScope" && it.kind !== "Summaries",
      ),
    );
    const contextSpec = {
      ...pins,
      fragmentIds: [...new Set([...(pins.fragmentIds ?? []), ...fragmentIds])],
    };
    void scope.dispatch({ type: "setBookmarksOpen", open: false });
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
              onClick={() =>
                void scope.dispatch({ type: "setBookmarksOpen", open: true })
              }
              disabled={bookmarkRows.length === 0}
            >
              <BookmarkSimpleIcon />
              Bookmarks
              {bookmarkRows.length > 0 && ` · ${bookmarkRows.length}`}
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={() => void scope.dispatch({ type: "toggleHistory" })}
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
              chat={chat}
              context={effectiveContext}
              onContextChange={handleContextChange}
              entity="chat"
              meter={{ conversationId: activeClientId }}
              onMention={mentionContext}
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
                    onClick={() =>
                      void scope.dispatch({
                        type: "setHistoryOpen",
                        open: false,
                      })
                    }
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
                onSelect={(conv) => void handleSelect(conv)}
              />
            </aside>
          )}
        </div>
      </PageCard>

      <BookmarksTray
        open={bookmarksOpen}
        onOpenChange={(open) =>
          void scope.dispatch({ type: "setBookmarksOpen", open })
        }
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
