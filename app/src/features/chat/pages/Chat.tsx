import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { generateId, type UIMessage } from "ai";
import { HistoryIcon, SquarePenIcon } from "lucide-react";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { ConversationList } from "@/features/chat";
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
} from "@/api/kalaidoscope/chat.ts";
import { defineRoute } from "@/routes/route-kit";
import { chatTransitions } from "./Chat.transitions";

export default function Chat() {
  const client = useKalaidoscopeClient();

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
  // ContextPicker owns its selection from `initialValues` at mount only, so we
  // remount it (via this key) whenever we programmatically reset `context`.
  // Bumping it in the same batch as setContext keeps the remount and the new
  // initialValues in sync — keying on the chat id instead would remount a
  // render too early, before the restored context is applied.
  const [pickerEpoch, setPickerEpoch] = useState(0);

  useEffect(() => {
    if (
      selected &&
      historyContextReady &&
      syncedClientId !== selected.clientId
    ) {
      setContext(historyContext);
      setSyncedClientId(selected.clientId);
      setPickerEpoch((e) => e + 1);
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
    setPickerEpoch((e) => e + 1);
    setHistoryOpen(false);
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
            <Button variant="outline" size="sm" onClick={handleNew}>
              <SquarePenIcon />
              New
            </Button>
            <Button
              variant="outline"
              size="sm"
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
          <ContextPicker
            key={pickerEpoch}
            initialValues={context}
            onChange={setContext}
          />
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
