import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { FilePicker } from "./file-picker";

export default { title: "Import / FilePicker" };

export const Empty: Story = () => (
  <div className="p-4 max-w-xl">
    <FilePicker onChoose={action("onChoose")} />
  </div>
);

export const WithPath: Story = () => (
  <div className="p-4 max-w-xl">
    <FilePicker
      path="/Users/louis/Documents/archive.zip"
      onChoose={action("onChoose")}
    />
  </div>
);
