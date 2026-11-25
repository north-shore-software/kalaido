import {
  type ContextSpec,
  itemsToSpec,
} from "@kalaido/client/kalaidoscope/chat";
import { ChatPanel, PageHeader, PanelErrorBoundary } from "@kalaido/components";
import {
  PageCard,
  PaneHeader,
} from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  BookmarkSimpleIcon,
  ClockCounterClockwiseIcon,
  NotePencilIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkActions, type ProjectionStart } from "./bookmark-actions";
import { type BookmarkRow, BookmarksTray } from "./bookmarks-tray";
import { ChatMessageActions } from "./chat-message-actions";
import { ConversationList } from "./conversation-list";
import { useBookmarkActions } from "./hooks/use-bookmark-actions";
import { useBookmarks } from "./hooks/use-bookmarks";
import { useExploreSession } from "./hooks/use-explore-session";

/** The text a turn shows — what a bookmark of it keeps. */
function messageText(msg: UIMessage): string {
  return msg.parts
    .filter((part) => part.type === "text" && part.text?.trim())
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");
}

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
  const [capturedInitialPrompt] = useState(() => initialPrompt);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  const session = useExploreSession({
    defaultHistoryOpen: true,
    skipRecentRestore: Boolean(capturedInitialPrompt),
    recentConversationId,
    onRecentConversationChange,
  });

  const sentInitialPromptRef = useRef(false);
  const { sendUserMessage } = session.chat;
  useEffect(() => {
    if (sentInitialPromptRef.current) return;
    const prompt = capturedInitialPrompt?.trim();
    if (!prompt) return;
    sentInitialPromptRef.current = true;
    sendUserMessage(prompt);
  }, [capturedInitialPrompt, sendUserMessage]);

  const bookmarks = useBookmarks(session.activeClientId);
  const bookmarkRows = useMemo<BookmarkRow[]>(
    () =>
      session.chat.messages.flatMap((msg) => {
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
    [session.chat.messages, bookmarks.marks],
  );
  const actions = useBookmarkActions(session.activeClientId, bookmarks.marks);

  async function newColourFromBookmarks() {
    const ids = await actions.saveAll();
    if (!ids || ids.length === 0) return;
    setBookmarksOpen(false);
    onNewColourFromBookmarks(ids);
  }

  function startProjectionFromBookmarks({
    name,
    message,
    fragmentIds,
  }: ProjectionStart) {
    const pins = itemsToSpec(
      session.effectiveContext.filter(
        (it) => it.kind !== "WholeScope" && it.kind !== "Summaries",
      ),
    );
    const contextSpec = {
      ...pins,
      fragmentIds: [...new Set([...(pins.fragmentIds ?? []), ...fragmentIds])],
    };
    setBookmarksOpen(false);
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
            <Button variant="section" onClick={session.handleNew}>
              <NotePencilIcon />
              New
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={() => setBookmarksOpen(true)}
              disabled={bookmarkRows.length === 0}
            >
              <BookmarkSimpleIcon />
              Bookmarks
              {bookmarkRows.length > 0 && ` · ${bookmarkRows.length}`}
            </Button>
            <Button
              className="border-section-edge bg-section-wash text-section-ink hover:border-section hover:bg-section-wash hover:text-section-ink"
              onClick={session.toggleHistory}
            >
              <ClockCounterClockwiseIcon />
              History
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex flex-1 overflow-hidden">
          <PanelErrorBoundary label="the chat" resetKey={session.activeChatKey}>
            <ChatPanel
              flat
              key={session.activeChatKey}
              chat={session.chat}
              context={session.effectiveContext}
              onContextChange={session.handleContextChange}
              entity="chat"
              meter={{ conversationId: session.activeClientId }}
              onMention={session.mentionContext}
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

          {session.historyOpen && (
            <aside className="flex w-80 shrink-0 min-h-0 flex-col overflow-hidden border-l border-line bg-surface-1">
              <PaneHeader
                label="History"
                status={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => session.setHistoryOpen(false)}
                    aria-label="Close history"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                }
              />
              <ConversationList
                conversations={session.conversations}
                selectedClientId={session.activeClientId}
                loading={session.loadingList}
                onSelect={(conv) => void session.handleSelect(conv)}
              />
            </aside>
          )}
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
    </>
  );
}
