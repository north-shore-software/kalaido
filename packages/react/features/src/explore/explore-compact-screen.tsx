import {
  type Conversation,
  getConversationMessages,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import {
  ChatPanel,
  type ContextItem,
  PanelErrorBoundary,
} from "@kalaido/components";
import { kalaidoscopeEndpointTag } from "@kalaido/hooks/kalaidoscope-live";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import { useKalaidoChat } from "@kalaido/hooks/use-kalaido-chat";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { PaneHeader } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kalaido/primitives/shadcn/dropdown-menu";
import { invalidateLiveTags } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import {
  CaretDownIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateId, type UIMessage } from "ai";
import type { Result } from "neverthrow";
import { useCallback, useEffect, useRef } from "react";
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

interface SelectedConversation {
  id: string;
  clientId: string;
  messages: UIMessage[];
}

interface CompactExploreState {
  selected: SelectedConversation | null;
  newChatId: string;
  context: ContextItem[];
  syncedClientId: string | null;
  historyOpen: boolean;
  switchingScope: boolean;
}

type CompactExploreEvent =
  | {
      readonly type: "selectConversation";
      readonly conversation: SelectedConversation;
      readonly closeHistory?: boolean;
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
  | { readonly type: "setSwitchingScope"; readonly switching: boolean };

export interface ExploreCompactScreenProps {
  workspaces: readonly KalaidoscopeMeta[];
  /** Most recent conversation id for this workspace, handed down from root app state. */
  recentConversationId?: string | null;
  onRecentConversationChange?: (conversationId: string | null) => void;
  onSyncWorkspaces: () => Promise<Result<void, Error>>;
  onSelectWorkspace: (id: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function ExploreCompactScreen({
  workspaces,
  recentConversationId,
  onRecentConversationChange,
  onSyncWorkspaces,
  onSelectWorkspace,
  onSignOut,
}: ExploreCompactScreenProps) {
  const client = useKalaidoscopeClient();
  const activeScope = useActiveKalaidoscope();
  const cloudScopes = activeKalaidoscopes(workspaces).filter(
    (k) => k.type === "cloud",
  );
  const { conversations, loading: loadingList } = useConversations();

  const handlers: ScopeHandlers<CompactExploreState, CompactExploreEvent> = {
    selectConversation: (s, e) => {
      s.selected = e.conversation;
      if (e.closeHistory) s.historyOpen = false;
    },
    startNew: (s, e) => {
      s.selected = null;
      s.newChatId = e.nextChatId;
      s.context = [WHOLE_SCOPE_ITEM];
      s.syncedClientId = null;
      s.historyOpen = false;
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
    setSwitchingScope: (s, e) => {
      s.switchingScope = e.switching;
    },
  };
  const scope = useScope({
    initial: (): CompactExploreState => ({
      selected: null,
      newChatId: generateId(),
      context: [WHOLE_SCOPE_ITEM],
      syncedClientId: null,
      historyOpen: false,
      switchingScope: false,
    }),
    handlers,
  });

  const {
    selected,
    newChatId,
    context,
    syncedClientId,
    historyOpen,
    switchingScope,
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

  useEffect(() => {
    void onSyncWorkspaces();
  }, [onSyncWorkspaces]);

  const restoredRecentRef = useRef(false);
  useEffect(() => {
    if (restoredRecentRef.current || !recentConversationId || loadingList) {
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
  }, [recentConversationId, loadingList, conversations, client, scope]);

  const activeClientId = selected?.clientId ?? newChatId;
  const activeChatKey = selected?.id ?? newChatId;

  const bookmarks = useBookmarks(activeClientId);
  const actions = useBookmarkActions(activeClientId, bookmarks.marks);

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

  const bookmarkedCount = chat.messages.filter(
    (msg) => msg.role !== "system" && bookmarks.marks.get(msg.id)?.bookmarked,
  ).length;
  const savedCount = chat.messages.filter(
    (msg) =>
      msg.role !== "system" &&
      bookmarks.marks.get(msg.id)?.bookmarked &&
      bookmarks.marks.get(msg.id)?.fragmentId,
  ).length;
  const allSaved = bookmarkedCount > 0 && savedCount === bookmarkedCount;
  const busy = actions.phase !== "idle";

  async function handleSelect(conv: Conversation) {
    restoredRecentRef.current = true;
    try {
      const messages = await getConversationMessages(client, conv.id);
      await scope.dispatch({
        type: "selectConversation",
        conversation: { id: conv.id, clientId: conv.clientId, messages },
        closeHistory: true,
      });
      onRecentConversationChange?.(conv.clientId);
    } catch (err) {
      console.error(err);
    }
  }

  function handleNew() {
    restoredRecentRef.current = true;
    void scope.dispatch({ type: "startNew", nextChatId: generateId() });
    onRecentConversationChange?.(null);
  }

  async function handleSelectScope(id: string) {
    if (id === activeScope?.id || switchingScope) return;
    await scope.dispatch({ type: "setSwitchingScope", switching: true });
    try {
      await onSelectWorkspace(id);
    } finally {
      await scope.dispatch({ type: "setSwitchingScope", switching: false });
    }
  }

  const save = () => void actions.saveAll();

  return (
    <div
      className="flex flex-col bg-background"
      style={{
        height: "var(--page-height, calc(100svh - var(--titlebar-height)))",
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex min-w-0 items-center gap-1.5 text-item font-medium text-foreground outline-none">
            <span className="truncate">
              {activeScope?.displayName ?? "Explore"}
            </span>
            <CaretDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="w-64">
            {cloudScopes.map((ws) => {
              const isActive = ws.id === activeScope?.id;
              return (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => void handleSelectScope(ws.id)}
                  disabled={switchingScope}
                  className="cursor-pointer justify-between gap-2 px-3 py-2.5 text-item normal-case tracking-normal"
                >
                  <span className="truncate font-medium">{ws.displayName}</span>
                  {isActive && <CheckIcon className="size-4 shrink-0" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void onSignOut()}
              disabled={switchingScope}
              className="cursor-pointer px-3 py-2.5 text-item normal-case tracking-normal"
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="New chat"
            onClick={handleNew}
          >
            <NotePencilIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="History"
            aria-pressed={historyOpen}
            onClick={() => void scope.dispatch({ type: "toggleHistory" })}
          >
            <ClockCounterClockwiseIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="section"
            size="sm"
            onClick={save}
            disabled={busy || bookmarkedCount === 0 || allSaved}
          >
            {actions.phase === "saving"
              ? "Saving…"
              : allSaved
                ? "Saved"
                : bookmarkedCount > 0
                  ? `Save ${bookmarkedCount}`
                  : "Save"}
          </Button>
        </div>
      </header>
      <main className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <PanelErrorBoundary label="the chat" resetKey={activeChatKey}>
          <ChatPanel
            flat
            key={activeChatKey}
            chat={chat}
            context={effectiveContext}
            onContextChange={handleContextChange}
            onMention={mentionContext}
            entity="chat"
            meter={{ conversationId: activeClientId }}
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
            actionsVisibleFor={() => true}
          />
        </PanelErrorBoundary>
        {historyOpen && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background">
            <PaneHeader
              label="History"
              status={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close history"
                  onClick={() =>
                    void scope.dispatch({
                      type: "setHistoryOpen",
                      open: false,
                    })
                  }
                >
                  <XIcon className="size-3.5" />
                </Button>
              }
            />
            <ConversationList
              conversations={conversations}
              selectedClientId={selected?.clientId}
              loading={loadingList}
              onSelect={(conv) => void handleSelect(conv)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
