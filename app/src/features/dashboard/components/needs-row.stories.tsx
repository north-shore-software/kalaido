import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { mockNeedItems } from "../fixtures";
import { NeedsRow } from "./needs-row";

export default { title: "Dashboard / NeedsRow" };

export const Default: Story = () => {
  return (
    <div className="max-w-xl space-y-4 p-4">
      <NeedsRow item={mockNeedItems[0]} onAction={action("onAction")} />
      <NeedsRow item={mockNeedItems[1]} onAction={action("onAction")} />
    </div>
  );
};
