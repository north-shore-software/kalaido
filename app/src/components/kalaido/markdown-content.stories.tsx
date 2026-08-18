import type { Story } from "@ladle/react";
import { mockMarkdownContent1 } from "@/features/projections/fixtures.ts";
import { MarkdownContent } from "./markdown-content.tsx";

export default { title: "Kalaido / MarkdownContent" };

const kitchenSink = `# Kitchen Sink

Regular paragraph with **bold**, *italic*, ~~struck~~ text and \`inline code\`.

## Lists

- Unordered item
- Item with [a link](https://example.com)
  - Nested item

1. Ordered first
2. Ordered second

- [ ] Open task
- [x] Done task

## Quote and rule

> Blockquotes carry supporting voice, muted a step.

---

## Code

\`\`\`ts
export function segmentBlocks(md: string): string[] {
  return md.split(/\\n{2,}/);
}
\`\`\`

## Table

| Column | Detail |
| ------ | ------ |
| alpha  | first  |
| beta   | second |
`;

// Cut mid-fence and mid-emphasis: exercises incomplete-markdown handling.
const midStream = `${kitchenSink.slice(0, kitchenSink.indexOf("segmentBlocks"))}segmentBlo`;

export const Document: Story = () => (
  <div className="max-w-[640px] p-6 text-fg-1">
    <MarkdownContent content={mockMarkdownContent1} />
  </div>
);

export const DocumentKitchenSink: Story = () => (
  <div className="max-w-[640px] p-6 text-fg-1">
    <MarkdownContent content={kitchenSink} />
  </div>
);

export const Chat: Story = () => (
  <div className="max-w-[70%] bg-surface-2 px-4 py-2.5 text-sm leading-relaxed break-words text-fg-1">
    <MarkdownContent variant="chat" content={kitchenSink} />
  </div>
);

export const Streaming: Story = () => (
  <div className="max-w-[640px] p-6 text-fg-1">
    <MarkdownContent streaming content={midStream} />
  </div>
);
