import type { Story } from "@ladle/react";
import { EditDiffBoxes } from "./edit-diff-boxes";

export default { title: "Kalaido / EditDiffBoxes" };

const before =
  "## Key Changes\n\n- **Backend**: Added `ReviseProposalEdit` to update edit proposals by ID without text search, preserved original `ContentBefore` across revisions, and streamed execution status via `data-refine_result`.";
const after =
  "## Key Changes\n\n- **Backend**: Added `ReviseProposalEdit` for ID-based proposal revisions and streamed status via `data-refine_result`.";

// The audit views (chat notices, the edit history popover): both halves shown.
export const FullDiff: Story = () => (
  <div className="max-w-xl border border-line bg-background p-4">
    <EditDiffBoxes before={before} after={after} />
  </div>
);

// A proposal card on the canvas: the new text is the document, the replaced
// text opens on demand.
export const ReplacedTextCollapsed: Story = () => (
  <div className="max-w-xl border border-line bg-background p-4">
    <EditDiffBoxes before={before} after={after} collapseBefore />
  </div>
);

// An insertion has nothing to collapse: no disclosure is drawn.
export const InsertionOnly: Story = () => (
  <div className="max-w-xl border border-line bg-background p-4">
    <EditDiffBoxes after={after} collapseBefore />
  </div>
);
