import type { Story } from "@ladle/react";
import { PinnedSection } from "./pinned-section";
import { mockPinItems } from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Dashboard / PinnedSection" };

export const Default: Story = () => {
  return (
    <div className="max-w-xl p-4">
      <PinnedSection
        items={mockPinItems}
        onOpen={action("onOpen")}
        onUnpin={action("onUnpin")}
      />
    </div>
  );
};

export const Empty: Story = () => {
  return (
    <div className="max-w-xl p-4">
      <PinnedSection
        items={[]}
        onOpen={action("onOpen")}
        onUnpin={action("onUnpin")}
      />
    </div>
  );
};
