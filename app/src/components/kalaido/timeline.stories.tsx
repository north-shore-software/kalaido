import type { Story } from "@ladle/react";
import { Timeline } from "./timeline.tsx";
import {
  TIMELINE_STABLE_FIXTURES,
  TIMELINE_TRUTH_FIXTURES,
} from "./fixtures.ts";

export default { title: "Kalaido / Timeline" };

export const TruthTone: Story = () => (
  <div className="max-w-md p-6 bg-card border rounded-lg">
    <h3 className="text-xs font-semibold uppercase mb-4 text-fg-3">
      Snapshot History
    </h3>
    <Timeline items={TIMELINE_TRUTH_FIXTURES} tone="magenta" />
  </div>
);

export const StableTone: Story = () => (
  <div className="max-w-md p-6 bg-card border rounded-lg">
    <h3 className="text-xs font-semibold uppercase mb-4 text-fg-3">
      Approved Reflection Runs
    </h3>
    <Timeline items={TIMELINE_STABLE_FIXTURES} tone="stable" />
  </div>
);

export const ClickableTimeline: Story = () => {
  const clickableItems = TIMELINE_TRUTH_FIXTURES.map((item, idx) => ({
    ...item,
    onClick: () =>
      console.log(`Timeline item clicked: index ${idx}, label: ${item.label}`),
  }));

  return (
    <div className="max-w-md p-6 bg-card border rounded-lg">
      <h3 className="text-xs font-semibold uppercase mb-4 text-fg-3">
        Interactive Log
      </h3>
      <Timeline items={clickableItems} tone="magenta" />
    </div>
  );
};
