import {
  type Conversation,
  getConversationMessages,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import type { ContextItem } from "@kalaido/components";
import { kalaidoscopeEndpointTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoChat } from "@kalaido/hooks/use-kalaido-chat";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { invalidateLiveTags } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { generateId, type UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveContext } from "./use-active-context";
import { useChatContextSelection } from "./use-chat-context-selection";
import {
  CHAT_CONVERSATIONS_ENDPOINT,
  useConversations,
} from "./use-conversations";

export interface SelectedConversation {
  id: string;
  clientId: string;
  messages: UIMessage[];
}

interface ExploreSessionState {
  selected: SelectedConversation | null;
  newChatId: string;
  context: ContextItem[];
  syncedClientId: string | null;
  historyOpen: boolean;
}

type ExploreSessionEvent =
  | {
      readonly type: "selectConversation";
      readonly conversation: SelectedConversation;
      readonly closeHistory?: boolean;
    }
  | {
      readonly type: "startNew";
      readonly nextChatId: string;
      readonly closeHistory?: boolean;
    }
  | { readonly type: "setContext"; readonly context: ContextItem[] }
  | {
      readonly type: "syncHistoryContext";
      readonly clientId: string;
      readonly context: ContextItem[];
    }
  | { readonly type: "setHistoryOpen"; readonly open: boolean }
  | { readonly type: "toggleHistory" };

const EXPLORE_SESSION_HANDLERS: ScopeHandlers<
  ExploreSessionState,
  ExploreSessionEvent
> = {
  selectConversation: (s, e) => {
    s.selected = e.conversation;
    if (e.closeHistory) s.historyOpen = false;
  },
  startNew: (s, e) => {
    s.selected = null;
    s.newChatId = e.nextChatId;
    s.context = [WHOLE_SCOPE_ITEM];
    s.syncedClientId = null;
    if (e.closeHistory) s.historyOpen = false;
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
};

export function useExploreSession({
  defaultHistoryOpen,
  closeHistoryOnAction = false,
  skipRecentRestore = false,
  recentConversationId,
  onRecentConversationChange,
}: {
  defaultHistoryOpen: boolean;
  closeHistoryOnAction?: boolean;
  skipRecentRestore?: boolean;
  recentConversationId?: string | null;
  onRecentConversationChange?: (conversationId: string | null) => void;
}) {
  const client = useKalaidoscopeClient();
  const [firstChatId] = useState(() => generateId());

  const scope = useScope({
    initial: (): ExploreSessionState => ({
      selected: null,
      newChatId: firstChatId,
      context: [WHOLE_SCOPE_ITEM],
      syncedClientId: null,
      historyOpen: defaultHistoryOpen,
    }),
    handlers: EXPLORE_SESSION_HANDLERS,
  });

  const { selected, newChatId, context, syncedClientId, historyOpen } =
    useScopeState(scope);

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

  const restoredRecentRef = useRef(false);
  useEffect(() => {
    if (
      restoredRecentRef.current ||
      skipRecentRestore ||
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
    skipRecentRestore,
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
          closeHistory: closeHistoryOnAction,
        });
        onRecentConversationChange?.(conv.clientId);
      } catch (err) {
        console.error(err);
      }
    },
    [client, scope, closeHistoryOnAction, onRecentConversationChange],
  );

  const handleNew = useCallback(() => {
    restoredRecentRef.current = true;
    void scope.dispatch({
      type: "startNew",
      nextChatId: generateId(),
      closeHistory: closeHistoryOnAction,
    });
    onRecentConversationChange?.(null);
  }, [scope, closeHistoryOnAction, onRecentConversationChange]);

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

  return {
    selected,
    activeClientId,
    activeChatKey,
    conversations,
    loadingList,
    historyOpen,
    setHistoryOpen: (open: boolean) =>
      void scope.dispatch({ type: "setHistoryOpen", open }),
    toggleHistory: () => void scope.dispatch({ type: "toggleHistory" }),
    effectiveContext,
    handleContextChange,
    mentionContext,
    handleSelect,
    handleNew,
    chat,
  };
}
