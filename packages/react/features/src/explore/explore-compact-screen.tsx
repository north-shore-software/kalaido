import {
  type Conversation,
  getConversationMessages,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  ChatPanel,
  type ContextItem,
  PanelErrorBoundary,
} from "@kalaido/components";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
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
import {
  CaretDownIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateId, type UIMessage } from "ai";
import type { Result } from "neverthrow";
import { useEffect, useState } from "react";
import { ChatMessageActions } from "./chat-message-actions";
import { ConversationList } from "./conversation-list";
import { useActiveContext } from "./hooks/use-active-context";
import { useBookmarkActions } from "./hooks/use-bookmark-actions";
import { useBookmarks } from "./hooks/use-bookmarks";
import { useConversations } from "./hooks/use-conversations";

export interface ExploreCompactScreenProps {
  workspaces: readonly KalaidoscopeMeta[];
  onSyncWorkspaces: () => Promise<Result<void, Error>>;
  onSelectWorkspace: (id: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function ExploreCompactScreen({
  workspaces,
  onSyncWorkspaces,
  onSelectWorkspace,
  onSignOut,
}: ExploreCompactScreenProps) {
  const client = useKalaidoscopeClient();
  const activeScope = useActiveKalaidoscope();
  const cloudScopes = activeKalaidoscopes(workspaces).filter(
    (k) => k.type === "cloud",
  );
  const { conversations, loading: loadingList, refresh } = useConversations();
  const [selected, setSelected] = useState<{
    id: string;
    clientId: string;
    messages: UIMessage[];
  } | null>(null);
  const [newChatId, setNewChatId] = useState(() => generateId());
  const [liveMessages, setLiveMessages] = useState<UIMessage[]>([]);
  const [context, setContext] = useState<ContextItem[]>([WHOLE_SCOPE_ITEM]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [switchingScope, setSwitchingScope] = useState(false);

  useEffect(() => {
    void onSyncWorkspaces();
  }, [onSyncWorkspaces]);

  const activeClientId = selected?.clientId ?? newChatId;
  const activeChatKey = selected?.id ?? newChatId;

  const bookmarks = useBookmarks(activeClientId);
  const actions = useBookmarkActions(activeClientId, bookmarks.refresh);

  const { items: historyContext, ready: historyContextReady } =
    useActiveContext(selected?.messages ?? []);
  const [syncedClientId, setSyncedClientId] = useState<string | null>(null);

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

  const bookmarkedCount = liveMessages.filter(
    (msg) => msg.role !== "system" && bookmarks.marks.get(msg.id)?.bookmarked,
  ).length;
  const savedCount = liveMessages.filter(
    (msg) =>
      msg.role !== "system" &&
      bookmarks.marks.get(msg.id)?.bookmarked &&
      bookmarks.marks.get(msg.id)?.fragmentId,
  ).length;
  const allSaved = bookmarkedCount > 0 && savedCount === bookmarkedCount;
  const busy = actions.phase !== "idle";

  async function handleSelect(conv: Conversation) {
    try {
      const messages = await getConversationMessages(client, conv.id);
      setSelected({ id: conv.id, clientId: conv.clientId, messages });
      setLiveMessages(messages);
      setHistoryOpen(false);
    } catch (err) {
      console.error(err);
    }
  }

  function handleNew() {
    setSelected(null);
    setNewChatId(generateId());
    setLiveMessages([]);
    setContext([WHOLE_SCOPE_ITEM]);
    setSyncedClientId(null);
    setHistoryOpen(false);
  }

  async function handleSelectScope(id: string) {
    if (id === activeScope?.id || switchingScope) return;
    setSwitchingScope(true);
    try {
      await onSelectWorkspace(id);
    } finally {
      setSwitchingScope(false);
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
            {cloudScopes.map((scope) => {
              const isActive = scope.id === activeScope?.id;
              return (
                <DropdownMenuItem
                  key={scope.id}
                  onClick={() => void handleSelectScope(scope.id)}
                  disabled={switchingScope}
                  className="cursor-pointer justify-between gap-2 px-3 py-2.5 text-item normal-case tracking-normal"
                >
                  <span className="truncate font-medium">
                    {scope.displayName}
                  </span>
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
            onClick={() => setHistoryOpen((v) => !v)}
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
            chatId={activeClientId}
            initialMessages={selected?.messages ?? []}
            context={context}
            onContextChange={setContext}
            onMention={(item) =>
              setContext((prev) => withContextItem(prev, item))
            }
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
            onMessagesChange={setLiveMessages}
            onTurnComplete={() => {
              refresh();
            }}
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
                  onClick={() => setHistoryOpen(false)}
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
