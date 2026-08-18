import type { Story } from "@ladle/react";
import { mockMarkdownContent1, mockMarkdownContent2 } from "../fixtures";
import { SnapshotComparePane } from "./snapshot-compare-pane";

export default { title: "Projections / SnapshotComparePane" };

const frame = "h-[420px] border border-line bg-background";

// The fixture pending snapshot: one list item appended.
const appended = `${mockMarkdownContent1}\n- Review updates added.`;

export const SmallRefinement: Story = () => (
  <div className={frame}>
    <SnapshotComparePane
      currentContent={mockMarkdownContent1}
      pendingContent={appended}
    />
  </div>
);

// Two unrelated documents — exercises the similarity gate: blocks should
// read as clean removed/added pairs, not word confetti.
export const HeavyRewrite: Story = () => (
  <div className={frame}>
    <SnapshotComparePane
      currentContent={mockMarkdownContent1}
      pendingContent={mockMarkdownContent2}
    />
  </div>
);

// First snapshot generation: the whole candidate is additions.
export const EmptyBaseline: Story = () => (
  <div className={frame}>
    <SnapshotComparePane pendingContent={mockMarkdownContent2} />
  </div>
);

export const EmptyCandidate: Story = () => (
  <div className={frame}>
    <SnapshotComparePane currentContent={mockMarkdownContent1} />
  </div>
);

export const Refining: Story = () => (
  <div className={frame}>
    <SnapshotComparePane
      currentContent={mockMarkdownContent1}
      pendingContent={appended}
      refining
    />
  </div>
);
