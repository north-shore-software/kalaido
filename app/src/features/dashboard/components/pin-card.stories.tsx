import type { Story } from "@ladle/react";
import { PinCard } from "./pin-card";
import { mockPinItems } from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Dashboard / PinCard" };

export const Default: Story = () => {
  return (
    <div className="flex max-w-xl flex-wrap gap-4 p-4">
      <PinCard
        item={mockPinItems[0]}
        onOpen={action("onOpen")}
        onUnpin={action("onUnpin")}
      />
      <PinCard
        item={mockPinItems[1]}
        onOpen={action("onOpen")}
        onUnpin={action("onUnpin")}
      />
    </div>
  );
};
