import type { Story } from "@ladle/react";
import { Button } from "@/components/ui/button";
import { fixtureBookmarkRows } from "../fixtures";
import { BookmarksTray } from "./bookmarks-tray";

export default { title: "Chat / BookmarksTray" };

export const Default: Story = () => (
  <BookmarksTray
    open
    onOpenChange={() => {}}
    rows={fixtureBookmarkRows}
    onUnbookmark={() => {}}
    footer={
      <Button variant="commit" size="sm">
        Save all as fragments
      </Button>
    }
  />
);

export const Empty: Story = () => (
  <BookmarksTray
    open
    onOpenChange={() => {}}
    rows={[]}
    onUnbookmark={() => {}}
  />
);
