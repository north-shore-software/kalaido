import { generateId, type UIMessage } from "ai";
import { BookmarkIcon, HistoryIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  type Conversation,
  getConversationMessages,
  itemsToSpec,
} from "@/api/kalaidoscope/chat.ts";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import { ChatPanel, type ContextItem } from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type BookmarkRow,
  BookmarksTray,
  ChatMessageActions,
  ConversationList,
} from "@/features/chat";
import {
  BookmarkActions,
  type ProjectionStart,
} from "@/features/chat/components/bookmark-actions";
import { useBookmarkActions } from "@/features/chat/hooks/use-bookmark-actions";
import { useBookmarks } from "@/features/chat/hooks/use-bookmarks";
import { useConversations } from "@/features/chat/hooks/use-conversations.ts";
import { useActiveContext } from "@/hooks/use-active-context";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { withContextItem } from "@/lib/mentions";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { chatTransitions } from "./Chat.transitions";

/** The text a turn shows — what a bookmark of it keeps. */
function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((part) => part.type === "text" && part.text?.trim())
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");
}

export default function Chat() {
  const client = useKalaidoscopeClient();
  const { go } = useAppNavigate();

  // A conversation can be seeded from another page (e.g. Home's composer):
  // `initialPrompt` is auto-sent on mount.
  const location = useLocation();
  const seed = (location.state ?? {}) as { initialPrompt?: string };
  // The active context selection, owned here and mirrored to the backend by
  // ChatPanel as `context_spec` stream messages. Starts as the whole scope in
  // full; the bar downgrades to summaries itself if that does not fit.
  const [context, setContext] = useState<ContextItem[]>([WHOLE_SCOPE_ITEM]);
  const initialPromptRef = useRef(seed.initialPrompt);

  const [historyOpen, setHistoryOpen] = useState(false);
  const { conversations, loading: loadingList, refresh } = useConversations();
  const [selected, setSelected] = useState<{
    id: string; // PocketBase record id — unique, used as the panel remount key
    clientId: string;
    messages: UIMessage[];
  } | null>(null);
  const [newChatId, setNewChatId] = useState(() => generateId());
  // The mount-time chat id — only this pristine chat receives the seeded prompt,
  // so starting/resuming another conversation never replays it.
  const firstChatIdRef = useRef(newChatId);

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

  async function handleSelect(conv: Conversation) {
    try {
      const messages = await getConversationMessages(client, conv.id);
      setSelected({ id: conv.id, clientId: conv.clientId, messages });
      setHistoryOpen(false);
    } catch (err) {
      console.error(err);
    }
  }

  function handleNew() {
    setSelected(null);
    setNewChatId(generateId());
    setContext([WHOLE_SCOPE_ITEM]);
    setSyncedClientId(null);
    setHistoryOpen(false);
  }

  // The AI SDK chat id: a resumed conversation's client id (to resume it
  // server-side), or the pending new chat's id.
  const activeClientId = selected?.clientId ?? newChatId;
  // The panel's remount key. Keyed on the unique PocketBase record id rather
  // than the client id: legacy conversations can share an empty client_id,
  // which would collapse to one key and leak useChat state between chats.
  const activeChatKey = selected?.id ?? newChatId;

  // The session's gathered turns. Marks live on the server rows; the live
  // transcript supplies the order and text.
  const bookmarks = useBookmarks(activeClientId);
  const [liveMessages, setLiveMessages] = useState<UIMessage[]>([]);
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
    go(chatTransitions.newColourFromBookmarks, {
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
    go(chatTransitions.graduateToProjection, {
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
        title="Chat"
        actions={
          <>
            <Button variant="section" onClick={handleNew}>
              <SquarePenIcon />
              New
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={() => setBookmarksOpen(true)}
              disabled={bookmarkRows.length === 0}
            >
              <BookmarkIcon />
              Bookmarks
              {bookmarkRows.length > 0 && ` · ${bookmarkRows.length}`}
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={() => setHistoryOpen(true)}
            >
              <HistoryIcon />
              History
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex flex-1 overflow-hidden">
          <ChatPanel
            flat
            key={activeChatKey}
            chatId={activeClientId}
            initialMessages={selected?.messages ?? []}
            initialPrompt={
              selected == null && activeClientId === firstChatIdRef.current
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

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-80 p-0 sm:max-w-sm">
          <SheetHeader className="p-4">
            <SheetTitle>History</SheetTitle>
          </SheetHeader>
          <ConversationList
            conversations={conversations}
            selectedClientId={selected?.clientId}
            loading={loadingList}
            onSelect={handleSelect}
          />
        </SheetContent>
      </Sheet>
    </PageLayout>
  );
}

export const chatRoute = defineRoute({
  id: "chat",
  path: "/chat",
  feature: "Chat",
  requiredScope: ["kalaidoscope"],
  transitions: chatTransitions,
  Component: Chat,
});
