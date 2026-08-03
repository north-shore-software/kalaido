import type { Story } from "@ladle/react";
import { PlaceholderPreviewPane } from "./placeholder-preview-pane";

export default { title: "Projections / PlaceholderPreviewPane" };

export const Default: Story = () => (
  <div className="h-[500px] border border-line flex flex-col bg-bg-1 w-[400px]">
    <PlaceholderPreviewPane />
  </div>
);
