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
          <div className="space-y-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv)}
                className={cn(
                  // Transparent border on every row so selection doesn't shift the text.
                  "w-full border-l-2 border-transparent px-3 py-2 text-left transition-colors hover:bg-accent",
                  conv.clientId === selectedClientId &&
                    "bg-accent border-primary",
                )}
              >
                <div className="truncate text-sm font-medium">
                  {conv.preview}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatShortDateTime(conv.createdAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
