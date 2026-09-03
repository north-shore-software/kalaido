import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { mockPinItems } from "../fixtures";
import { PinnedSection } from "./pinned-section";

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
