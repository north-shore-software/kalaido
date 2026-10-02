import {
  ArrowLeftIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateId, type UIMessage } from "ai";
import { useEffect, useState } from "react";
import {
  type Conversation,
  getConversationMessages,
} from "@/api/kalaidoscope/chat.ts";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  ChatPanel,
  type ContextItem,
  PanelErrorBoundary,
} from "@/components/kalaido";
import { PaneHeader } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { ChatMessageActions, ConversationList } from "@/features/explore";
import { useBookmarkActions } from "@/features/explore/hooks/use-bookmark-actions";
import { useBookmarks } from "@/features/explore/hooks/use-bookmarks";
import { useConversations } from "@/features/explore/hooks/use-conversations.ts";
import { useActiveContext } from "@/hooks/use-active-context";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { withContextItem } from "@/lib/mentions";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { exploreTransitions } from "./Explore.transitions";

export default function ExploreCompact() {
  const client = useKalaidoscopeClient();
  const { go } = useAppNavigate();
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

  const save = () => void actions.saveAll();

  return (
    <div
      className="flex flex-col bg-background"
      style={{
        height: "var(--page-height, calc(100svh - var(--titlebar-height)))",
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => go(exploreTransitions.chooseWorkspace)}
          aria-label="Workspaces"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <span className="text-item font-medium">Explore</span>
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
