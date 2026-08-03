import type { Story } from "@ladle/react";
import { SnapshotComparePane } from "./snapshot-compare-pane";
import {
  mockSnapshotContentCurrent,
  mockSnapshotContentPending,
} from "../fixtures";

export default { title: "Projections / SnapshotComparePane" };

export const Default: Story = () => (
  <div className="h-[500px] border border-line flex flex-col bg-bg-1">
    <SnapshotComparePane
      currentContent={mockSnapshotContentCurrent}
      pendingContent={mockSnapshotContentPending}
      refining={false}
    />
  </div>
);

export const Refining: Story = () => (
  <div className="h-[500px] border border-line flex flex-col bg-bg-1">
    <SnapshotComparePane
      currentContent={mockSnapshotContentCurrent}
      pendingContent={mockSnapshotContentPending}
      refining={true}
    />
  </div>
);
