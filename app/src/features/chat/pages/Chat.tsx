import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { generateId, type UIMessage } from "ai";
import { HistoryIcon, SquarePenIcon } from "lucide-react";
import { toast } from "sonner";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { ChatAnswerActions, ConversationList } from "@/features/chat";
import { refocusedContext } from "@/features/chat/refocus";
import {
  ChatPanel,
  type ContextItem,
  ContextPicker,
} from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { useActiveContext } from "@/hooks/use-active-context";
import { useConversations } from "@/features/chat/hooks/use-conversations.ts";
import {
  type Conversation,
  getConversationMessages,
  itemsToSpec,
} from "@/api/kalaidoscope/chat.ts";
import { fragmentLabel } from "@/hooks/use-fragment-labels";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { defineRoute } from "@/routes/route-kit";
import { chatTransitions } from "./Chat.transitions";

export default function Chat() {
  const client = useKalaidoscopeClient();
  const { go } = useAppNavigate();

  // A conversation can be seeded from another page (e.g. Home's composer):
  // `initialPrompt` is auto-sent on mount.
  const location = useLocation();
  const seed = (location.state ?? {}) as { initialPrompt?: string };
  // The active context selection, owned here and mirrored to the backend by
  // ChatPanel as `context_spec` stream messages. Starts empty; the picker fills
  // it from real sources.
  const [context, setContext] = useState<ContextItem[]>([]);
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
    setContext([]);
    setSyncedClientId(null);
    setHistoryOpen(false);
  }

  /**
   * Narrow onto one answer: a fresh chat whose subject is the fragment just
   * saved, with whatever the last chat was working from carried across as
   * background.
   *
   * This is a "new chat" in every sense — same reset as {@link handleNew}, so no
   * navigation and no route state — differing only in what it seeds the context
   * with. The prior messages are deliberately dropped: the fragment is what was
   * worth keeping from them.
   */
  function refocusOn(fragmentId: string) {
    setSelected(null);
    setNewChatId(generateId());
    setSyncedClientId(null);
    setContext((prev) => refocusedContext(prev, fragmentId));
    setHistoryOpen(false);
    toast.success("New chat focused on that answer");
  }

  /**
   * Graduate an answer into a projection: its text becomes the projection's
   * first draft, which approving distils into the lens — "keep producing
   * something shaped like this".
   *
   * The chat's own context becomes the projection's inputs, since that is the
   * material the answer was derived from and the material a living version
   * should keep reading. The focus marker is dropped on the way: a projection
   * has inputs, not a conversational subject.
   */
  function graduate({ content }: { content: string }) {
    go(chatTransitions.graduateToProjection, {
      state: {
        seed: {
          name: fragmentLabel(content),
          draft: content,
          contextSpec: itemsToSpec(
            context.map((it) => ({ ...it, focus: false })),
          ),
        },
      },
    });
  }

  // The AI SDK chat id: a resumed conversation's client id (to resume it
  // server-side), or the pending new chat's id.
  const activeClientId = selected?.clientId ?? newChatId;
  // The panel's remount key. Keyed on the unique PocketBase record id rather
  // than the client id: legacy conversations can share an empty client_id,
  // which would collapse to one key and leak useChat state between chats.
  const activeChatKey = selected?.id ?? newChatId;

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
          <ContextPicker entity="chat" value={context} onChange={setContext} />
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
            assistantActions={({ content }) => (
              <ChatAnswerActions
                content={content}
                clientId={activeClientId}
                onRefocus={refocusOn}
                onGraduate={graduate}
              />
            )}
            onTurnComplete={() => {
              refresh();
            }}
          />
        </div>
      </PageCard>

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
