import { BookmarkIcon, CheckIcon } from "lucide-react";
import { Pill } from "@/components/kalaido/pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";

interface ChatMessageActionsProps {
  bookmarked: boolean;
  /** Set once the conversation's bookmarks were saved and this turn became one. */
  fragmentId?: string;
  /** The turn has no row on the server yet, so it cannot be marked. */
  pending: boolean;
  onToggle: (bookmarked: boolean) => void;
}

/**
 * What can be done with one chat turn: bookmark it for the session. The
 * bookmark is only a mark — what becomes of the gathered turns is decided
 * once, for all of them, in the Bookmarks tray. A turn that has already been
 * saved says so, and keeps saying so after its bookmark is cleared.
 */
export function ChatMessageActions({
  bookmarked,
  fragmentId,
  pending,
  onToggle,
}: ChatMessageActionsProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className={cn(bookmarked ? "text-section-ink" : "text-fg-3")}
        onClick={() => onToggle(!bookmarked)}
        disabled={pending}
        title={pending ? "Wait for the reply to finish" : undefined}
        aria-pressed={bookmarked}
      >
        <BookmarkIcon className={cn(bookmarked && "fill-current")} />
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </Button>
      {fragmentId && (
        <Pill tone="muted">
          <CheckIcon />
          saved as fragment
        </Pill>
      )}
    </>
  );
}
