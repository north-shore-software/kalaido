import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import { ChatPanel, PanelErrorBoundary } from "@kalaido/components";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { PaneHeader } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { XIcon } from "@phosphor-icons/react";
import type { Result } from "neverthrow";
import { useEffect, useState } from "react";
import { ChatMessageActions } from "./chat-message-actions";
import { CompactExploreHeader } from "./components/compact-explore-header";
import { ConversationList } from "./conversation-list";
import { useBookmarkActions } from "./hooks/use-bookmark-actions";
import { useBookmarks } from "./hooks/use-bookmarks";
import { useExploreSession } from "./hooks/use-explore-session";

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
  const activeScope = useActiveKalaidoscope();
  const cloudScopes = activeKalaidoscopes(workspaces).filter(
    (k) => k.type === "cloud",
  );
  const [switchingScope, setSwitchingScope] = useState(false);

  const session = useExploreSession({
    defaultHistoryOpen: false,
    closeHistoryOnAction: true,
    recentConversationId,
    onRecentConversationChange,
  });

  useEffect(() => {
    void onSyncWorkspaces();
  }, [onSyncWorkspaces]);

  const bookmarks = useBookmarks(session.activeClientId);
  const actions = useBookmarkActions(session.activeClientId, bookmarks.marks);

  const bookmarkedCount = session.chat.messages.filter(
    (msg) => msg.role !== "system" && bookmarks.marks.get(msg.id)?.bookmarked,
  ).length;
  const savedCount = session.chat.messages.filter(
    (msg) =>
      msg.role !== "system" &&
      bookmarks.marks.get(msg.id)?.bookmarked &&
      bookmarks.marks.get(msg.id)?.fragmentId,
  ).length;
  const allSaved = bookmarkedCount > 0 && savedCount === bookmarkedCount;
  const busy = actions.phase !== "idle";

  async function handleSelectScope(id: string) {
    if (id === activeScope?.id || switchingScope) return;
    setSwitchingScope(true);
    try {
      await onSelectWorkspace(id);
    } finally {
      setSwitchingScope(false);
    }
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{
        height: "var(--page-height, calc(100svh - var(--titlebar-height)))",
      }}
    >
      <CompactExploreHeader
        activeScope={activeScope}
        cloudScopes={cloudScopes}
        switchingScope={switchingScope}
        historyOpen={session.historyOpen}
        bookmarkedCount={bookmarkedCount}
        allSaved={allSaved}
        saving={actions.phase === "saving"}
        busy={busy}
        onSelectScope={(id) => void handleSelectScope(id)}
        onSignOut={() => void onSignOut()}
        onNew={session.handleNew}
        onToggleHistory={session.toggleHistory}
        onSave={() => void actions.saveAll()}
      />
      <main className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <PanelErrorBoundary label="the chat" resetKey={session.activeChatKey}>
          <ChatPanel
            flat
            key={session.activeChatKey}
            chat={session.chat}
            context={session.effectiveContext}
            onContextChange={session.handleContextChange}
            onMention={session.mentionContext}
            entity="chat"
            meter={{ conversationId: session.activeClientId }}
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
        {session.historyOpen && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background">
            <PaneHeader
              label="History"
              status={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close history"
                  onClick={() => session.setHistoryOpen(false)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              }
            />
            <ConversationList
              conversations={session.conversations}
              selectedClientId={session.selected?.clientId}
              loading={session.loadingList}
              onSelect={(conv) => void session.handleSelect(conv)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
