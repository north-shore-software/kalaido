import type { Story } from "@ladle/react";
import { ChatMessageActions } from "./chat-message-actions";

export default { title: "Chat / ChatMessageActions" };

const wrap = "flex items-center gap-2 bg-background p-4";

export const Default: Story = () => (
  <div className={wrap}>
    <ChatMessageActions
      bookmarked={false}
      pending={false}
      onToggle={() => {}}
    />
  </div>
);

export const Bookmarked: Story = () => (
  <div className={wrap}>
    <ChatMessageActions bookmarked pending={false} onToggle={() => {}} />
  </div>
);

export const SavedAsFragment: Story = () => (
  <div className={wrap}>
    <ChatMessageActions
      bookmarked
      fragmentId="frag_1"
      pending={false}
      onToggle={() => {}}
    />
  </div>
);

/** While the reply is still streaming the turn cannot be bookmarked yet. */
export const Pending: Story = () => (
  <div className={wrap}>
    <ChatMessageActions bookmarked={false} pending onToggle={() => {}} />
  </div>
);
