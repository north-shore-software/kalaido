import { MessageCircleIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/css-utils";
import { formatShortDateTime } from "@/lib/datetime";
import type { Conversation } from "@/api/kalaidoscope/chat";

interface ConversationListProps {
  conversations: Conversation[];
  selectedClientId?: string;
  loading: boolean;
  onSelect: (conversation: Conversation) => void;
}

export function ConversationList({
  conversations,
  selectedClientId,
  loading,
  onSelect,
}: ConversationListProps) {
  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-3 pb-3">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => i).map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleIcon />
              </EmptyMedia>
              <EmptyTitle>No conversations yet</EmptyTitle>
              <EmptyDescription>
                Start chatting and your history will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-1.5">
            {conversations.map((conv) => {
              const isSelected = conv.clientId === selectedClientId;
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onSelect(conv)}
                  className={cn(
                    "w-full border border-line border-l-2 border-l-section-edge bg-surface-1 px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:border-l-2 hover:border-l-section hover:bg-section-wash",
                    isSelected &&
                      "border-line-strong border-l-2 border-l-section bg-section-wash",
                  )}
                >
                  <div
                    className={cn(
                      "truncate text-row",
                      isSelected
                        ? "font-semibold text-fg-1"
                        : "font-medium text-fg-2",
                    )}
                  >
                    {conv.preview}
                  </div>
                  <div className="mt-1 font-mono text-mono-sm text-fg-4">
                    {formatShortDateTime(conv.createdAt)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
