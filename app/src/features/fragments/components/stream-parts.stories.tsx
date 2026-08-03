import type { Story } from "@ladle/react";
import {
  DayHeader,
  StreamCard,
  StreamEmptyState,
  StreamSkeleton,
} from "./stream-parts";
import { mockFragments } from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Fragments / StreamParts" };

export const DayHeaderStory: Story = () => (
  <div className="p-4 max-w-xl">
    <DayHeader day="Today" first={true} />
    <DayHeader day="Yesterday" first={false} />
  </div>
);

export const StreamCardStory: Story = () => {
  const typicalFragment = mockFragments[0];
  const longTextFragment = {
    ...mockFragments[1],
    preview:
      "This is a very long text fragment preview that spans multiple lines. It is designed to test how the StreamCard component handles overflow text and wrapping behavior when presented with a large block of content in the timeline. The font should be mono, with correct spacing and line-height. Some more words are added here to ensure it actually exceeds three lines and hits the line clamp limit of line-clamp-3, so we can verify that the truncation is working beautifully with ellipsis.",
  };

  return (
    <div className="p-4 max-w-xl flex flex-col gap-4">
      <StreamCard f={typicalFragment} />
      <StreamCard f={longTextFragment} />
    </div>
  );
};

export const StreamSkeletonStory: Story = () => (
  <div className="p-4 max-w-xl">
    <StreamSkeleton />
  </div>
);

export const StreamEmptyStateStory: Story = () => (
  <div className="p-4 max-w-xl">
    <StreamEmptyState onImport={action("onImport")} />
  </div>
);
