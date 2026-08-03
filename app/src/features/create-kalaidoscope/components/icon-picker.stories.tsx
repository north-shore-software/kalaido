import type { Story } from "@ladle/react";
import { IconPicker } from "./icon-picker";
import { action } from "@/lib/story-utils.ts";

export default { title: "Setup / IconPicker" };

export const Empty: Story = () => (
  <div className="p-4 flex gap-4">
    <IconPicker onChange={action("onChange")} />
  </div>
);

export const Selected: Story = () => (
  <div className="p-4 flex gap-4">
    <IconPicker value="Heart" onChange={action("onChange")} />
  </div>
);
