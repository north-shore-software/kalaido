import type { Story } from "@ladle/react";
import { NeedsActionSection } from "./needs-action-section";
import { mockNeedItems } from "../fixtures";
import { action } from "@/lib/story-utils.ts";

export default { title: "Dashboard / NeedsActionSection" };

export const Default: Story = () => {
  return (
    <div className="max-w-xl p-4">
      <NeedsActionSection
        items={mockNeedItems}
        onAction={action("onAction")}
        onGenerateAll={action("onGenerateAll")}
      />
    </div>
  );
};

export const Empty: Story = () => {
  return (
    <div className="max-w-xl p-4">
      <p className="mb-2 text-xs text-fg-4">
        (Should render nothing below because items is empty)
      </p>
      <NeedsActionSection items={[]} onAction={action("onAction")} />
    </div>
  );
};
