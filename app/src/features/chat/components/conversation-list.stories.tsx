import type { Story } from "@ladle/react";
import { useState } from "react";
import type { Conversation } from "@/api/kalaidoscope/chat";
import { action } from "@/lib/story-utils.ts";
import { fixtureConversations } from "../fixtures";
import { ConversationList } from "./conversation-list";

export default { title: "Chat / ConversationList" };

export const Default: Story = () => {
  const [selected, setSelected] = useState<string | undefined>("client-1");
  return (
    <div className="max-w-xs h-[300px] border border-line bg-background rounded-lg p-2">
      <ConversationList
        conversations={fixtureConversations}
        selectedClientId={selected}
        loading={false}
        onSelect={(conv: Conversation) => setSelected(conv.clientId)}
      />
    </div>
  );
};

export const Empty: Story = () => (
  <div className="max-w-xs h-[300px] border border-line bg-background rounded-lg p-2">
    <ConversationList
      conversations={[]}
      loading={false}
      onSelect={action("onSelect")}
    />
  </div>
);

export const Loading: Story = () => (
  <div className="max-w-xs h-[300px] border border-line bg-background rounded-lg p-2">
    <ConversationList
      conversations={[]}
      loading={true}
      onSelect={action("onSelect")}
    />
  </div>
);
