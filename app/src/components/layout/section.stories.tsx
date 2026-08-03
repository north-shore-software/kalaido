import type { Story } from "@ladle/react";
import { SectionHeader } from "./section.tsx";

export default { title: "Layout / Section" };

export const Default: Story = () => (
  <div className="max-w-md p-6 bg-card border border-line rounded-lg">
    <SectionHeader
      title="Advanced Database Sync"
      description="Enable real-time synchronization with remote Pocketbase servers or configure a local-only background SQLite sidecar."
    />
  </div>
);

export const TitleOnly: Story = () => (
  <div className="max-w-md p-6 bg-card border border-line rounded-lg">
    <SectionHeader title="Danger Zone" />
  </div>
);
