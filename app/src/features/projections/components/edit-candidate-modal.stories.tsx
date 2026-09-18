import type { Story } from "@ladle/react";
import { EditCandidateModal } from "./edit-candidate-modal";

export default { title: "Projections / EditCandidateModal" };

const OLD_TEXT =
  "Shipping the schema migration first keeps the rollout reversible.";

export const Open: Story = () => (
  <EditCandidateModal
    open
    oldText={OLD_TEXT}
    saving={false}
    onClose={() => {}}
    onSubmit={() => {}}
  />
);

export const Saving: Story = () => (
  <EditCandidateModal
    open
    oldText={OLD_TEXT}
    saving
    onClose={() => {}}
    onSubmit={() => {}}
  />
);

export const WithError: Story = () => (
  <EditCandidateModal
    open
    oldText={OLD_TEXT}
    saving={false}
    error="That passage is no longer in the candidate."
    onClose={() => {}}
    onSubmit={() => {}}
  />
);
