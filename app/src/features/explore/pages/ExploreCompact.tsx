import { ArrowLeftIcon } from "@phosphor-icons/react";
import { generateId } from "ai";
import { useState } from "react";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  ChatPanel,
  type ContextItem,
  PanelErrorBoundary,
} from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client";
import { withContextItem } from "@/lib/mentions";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { exploreTransitions } from "./Explore.transitions";

export default function ExploreCompact() {
  const client = useKalaidoscopeClient();
  void client;
  const { go } = useAppNavigate();
  const [chatId] = useState(() => generateId());
  const [context, setContext] = useState<ContextItem[]>([WHOLE_SCOPE_ITEM]);

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
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
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <PanelErrorBoundary label="the chat" resetKey={chatId}>
          <ChatPanel
            flat
            chatId={chatId}
            context={context}
            onContextChange={setContext}
            onMention={(item) =>
              setContext((prev) => withContextItem(prev, item))
            }
            entity="chat"
            meter={{ conversationId: chatId }}
          />
        </PanelErrorBoundary>
      </main>
    </div>
  );
}
