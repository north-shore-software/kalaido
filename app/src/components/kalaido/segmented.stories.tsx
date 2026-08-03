import type { Story } from "@ladle/react";
import { Segmented } from "./segmented.tsx";

export default { title: "Kalaido / Segmented" };

const VIEW_OPTIONS = ["List", "Grid", "Split-Pane"] as const;
const TIME_OPTIONS = ["24h", "7d", "30d", "All"] as const;

export const InteractiveTwoOptions: Story = () => (
  <div className="p-4">
    <Segmented
      items={["Light", "Dark"] as const}
      value="Dark"
      onChange={(v) => console.log("Segment changed to:", v)}
    />
  </div>
);

export const InteractiveThreePlusOptions: Story = () => (
  <div className="p-4">
    <Segmented
      items={VIEW_OPTIONS}
      value="List"
      onChange={(v) => console.log("Segment changed to:", v)}
    />
  </div>
);

export const TimeSelection: Story = () => (
  <div className="p-4">
    <Segmented
      items={TIME_OPTIONS}
      value="7d"
      onChange={(v) => console.log("Segment changed to:", v)}
    />
  </div>
);

export const ReadOnlySegment: Story = () => (
  <div className="p-4">
    <Segmented items={VIEW_OPTIONS} value="Grid" />
  </div>
);
