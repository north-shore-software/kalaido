import { BookmarkSimpleIcon } from "@phosphor-icons/react";
import type { Story } from "@ladle/react";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { fixtureMessages } from "./fixtures";
import { ChatMessages } from "./chat-messages";

export default { title: "Kalaido / ChatMessages" };

export const Empty: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-none space-y-3">
    <ChatMessages messages={[]} greeting="Hello! How can I help you today?" />
  </div>
);

export const Conversation: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-none space-y-3">
    <ChatMessages messages={fixtureMessages} />
  </div>
);

export const Streaming: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-none space-y-3">
    <ChatMessages messages={fixtureMessages} pending />
  </div>
);

// Either turn can carry actions — bookmarking it for the session is the
// first. They sit under the bubble and reveal on hover.
export const WithMessageActions: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-none space-y-3">
    <ChatMessages
      messages={fixtureMessages}
      messageActions={({ pending }) => (
        <Button
          variant="ghost"
          size="xs"
          className="text-fg-3"
          disabled={pending}
        >
          <BookmarkSimpleIcon />
          Bookmark
        </Button>
      )}
    />
  </div>
);

// Assistant replies are markdown; mention tokens render as chips inside it.
// User bubbles stay verbatim — their `# not a heading` prints literally.
const markdownMessages: UIMessage[] = [
  {
    id: "md-1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "# not a heading — summarize @[Fragment:abc123def456ghi|standup notes]",
      },
    ],
  },
  {
    id: "md-2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: [
          "## Summary of @[Fragment:abc123def456ghi|standup notes]",
          "",
          "Two themes stand out, both **carried over** from last week:",
          "",
          "1. Deploy pipeline flakiness",
          "2. Review backlog",
          "",
          "```ts",
          "const blocked = reviews.filter((r) => r.age > 3);",
          "```",
        ].join("\n"),
      },
    ],
  },
];

export const MarkdownWithMentions: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-none space-y-3">
    <ChatMessages messages={markdownMessages} />
  </div>
);
