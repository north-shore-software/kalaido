import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import { ModelDownloadCard } from "./model-download-card";

export default { title: "Settings / ModelDownloadCard" };

export const Idle: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <ModelDownloadCard
        modelName="gemma3"
        pulling={false}
        onDownload={() => alert("Started download!")}
        onCancel={action("onCancel")}
      />
    </div>
  );
};

export const DownloadingWithProgress: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <ModelDownloadCard
        modelName="gemma3"
        pulling={true}
        pullPct={68}
        pullStatus="pulling manifest"
        onDownload={action("onDownload")}
        onCancel={() => alert("Cancelled!")}
      />
    </div>
  );
};

export const ErrorState: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <ModelDownloadCard
        modelName="gemma3"
        pulling={false}
        pullError="Disk full or network unreachable"
        onDownload={action("onDownload")}
        onCancel={action("onCancel")}
      />
    </div>
  );
};
