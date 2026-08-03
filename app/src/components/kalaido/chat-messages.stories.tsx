import type { Story } from "@ladle/react";
import { ChatMessages } from "./chat-messages";
import { fixtureMessages } from "../../features/chat/fixtures";

export default { title: "Kalaido / ChatMessages" };

export const Empty: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-lg space-y-3">
    <ChatMessages messages={[]} greeting="Hello! How can I help you today?" />
  </div>
);

export const Conversation: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-lg space-y-3">
    <ChatMessages messages={fixtureMessages} />
  </div>
);

export const Streaming: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-lg space-y-3">
    <ChatMessages messages={fixtureMessages} pending />
  </div>
);
