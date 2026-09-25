import { WarningIcon } from "@phosphor-icons/react";
import type { Story } from "@ladle/react";
import { DecisionCard } from "./decision-card";

export default { title: "Kalaido / DecisionCard" };

const icon = <WarningIcon className="size-4 shrink-0 text-drifting-ink" />;
const noop = () => {};

// The review page's outdated-candidate gate, on a candidate the reader has
// edited or refined: their work stays, so folding in is the recommended answer.
export const EngagedCandidate: Story = () => (
  <div className="max-w-md space-y-3 border border-line bg-background p-4">
    <DecisionCard
      icon={icon}
      title="Candidate is out of date"
      description="1 new fragment arrived after this candidate was generated (Sep 25 at 12:50 AM). Your edits and refinements live on this candidate, so choose how to bring it up to date."
      options={[
        {
          id: "fold-in",
          label: "Approve & fold in",
          variant: "commit",
          onSelect: noop,
        },
        {
          id: "start-over",
          label: "Start over",
          variant: "destructive",
          onSelect: noop,
        },
      ]}
    />
  </div>
);

// Nothing on the candidate is the reader's: regenerating loses nothing.
export const UntouchedCandidate: Story = () => (
  <div className="max-w-md space-y-3 border border-line bg-background p-4">
    <DecisionCard
      icon={icon}
      title="Candidate is out of date"
      description="The lens changed after this candidate was generated (Sep 25 at 12:50 AM). Nothing has been edited on it, so it can simply be regenerated."
      options={[
        { id: "refresh", label: "Refresh", variant: "commit", onSelect: noop },
      ]}
    />
  </div>
);

// An answer is being carried out.
export const Busy: Story = () => (
  <div className="max-w-md space-y-3 border border-line bg-background p-4">
    <DecisionCard
      icon={icon}
      title="Candidate is out of date"
      description="1 new fragment arrived after this candidate was generated (Sep 25 at 12:50 AM). Nothing has been edited on it, so it can simply be regenerated."
      busy
      options={[
        { id: "refresh", label: "Refresh", variant: "commit", onSelect: noop },
      ]}
    />
  </div>
);
