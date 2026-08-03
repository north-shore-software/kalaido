import type { Story } from "@ladle/react";
import { LivePreviewPane } from "./live-preview-pane";
import { FIXTURE_CONTENT_1 } from "../fixtures";

export default { title: "Reflections / LivePreviewPane" };

export const NotStarted: Story = () => {
  return (
    <div className="w-[322px] h-[500px] border border-line bg-card flex flex-col">
      <LivePreviewPane started={false} />
    </div>
  );
};

export const Generating: Story = () => {
  return (
    <div className="w-[322px] h-[500px] border border-line bg-card flex flex-col">
      <LivePreviewPane started={true} preview="" />
    </div>
  );
};

export const WithPreview: Story = () => {
  return (
    <div className="w-[322px] h-[500px] border border-line bg-card flex flex-col">
      <LivePreviewPane started={true} preview={FIXTURE_CONTENT_1} />
    </div>
  );
};
