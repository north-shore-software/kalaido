import type { Story } from "@ladle/react";
import { StorageOptionCards } from "./storage-option-cards";
import { action } from "@/lib/story-utils.ts";

export default { title: "Setup / StorageOptionCards" };

export const LocalSelected: Story = () => (
  <div className="p-4 max-w-md">
    <StorageOptionCards value="local_file" onChange={action("onChange")} />
  </div>
);

export const CloudSelected: Story = () => (
  <div className="p-4 max-w-md">
    <StorageOptionCards value="cloud" onChange={action("onChange")} />
  </div>
);
