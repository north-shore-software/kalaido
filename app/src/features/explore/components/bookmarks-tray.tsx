import { BookmarkSimpleIcon, XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Pill } from "@/components/kalaido/pill";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { stripMentions } from "@/lib/mentions";

export interface BookmarkRow {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  /** Set once this turn has been saved as a fragment. */
  fragmentId?: string;
}

interface BookmarksTrayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bookmarked turns in transcript order. */
  rows: BookmarkRow[];
  onUnbookmark: (messageId: string) => void;
  /** The batch actions on everything listed — the tray's reason to exist. */
  footer?: ReactNode;
}

/**
 * What the session has gathered so far, and what to do with it. Bookmarks
 * accumulate here over the conversation; the footer acts on all of them at
 * once, which is the "and then" a finite chat needs.
 */
export function BookmarksTray({
  open,
  onOpenChange,
  rows,
  onUnbookmark,
  footer,
}: BookmarksTrayProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-96 flex-col p-0 sm:max-w-md">
        <SheetHeader className="p-4">
          <SheetTitle className="flex items-center gap-2">
            Bookmarks
            {rows.length > 0 && <Pill tone="muted">{rows.length}</Pill>}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookmarkSimpleIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing bookmarked yet</EmptyTitle>
                <EmptyDescription>
                  Bookmark the turns worth keeping as you go; save them all at
                  once when you're done.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-1.5">
              {rows.map((row) => (
                <div
                  key={row.messageId}
                  className="group/row flex items-start gap-2 border border-line bg-surface-1 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Pill tone="muted">{row.role}</Pill>
                      {row.fragmentId && <Pill>saved</Pill>}
                    </div>
                    <div className="line-clamp-2 text-row text-fg-2">
                      {stripMentions(row.content)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-fg-4 hover:text-fg-2"
                    onClick={() => onUnbookmark(row.messageId)}
                    title="Remove bookmark"
                    aria-label="Remove bookmark"
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        {footer && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface-1 p-4">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
