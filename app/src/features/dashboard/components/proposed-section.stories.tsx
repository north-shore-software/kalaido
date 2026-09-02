import type { Story } from "@ladle/react";
import { ProposedSection } from "./proposed-section";
import { action } from "@/lib/story-utils.ts";
import type { ProposedItem } from "../types";

export default { title: "Dashboard / ProposedSection" };

const items: ProposedItem[] = [
  {
    id: "p1",
    kind: "projection",
    name: "Lift maintenance contract",
    message:
      "Keep a current account of the lift maintenance arrangement: who holds the contract, what was quoted and agreed, and what is outstanding.",
    fragments: 42,
  },
  {
    id: "r1",
    kind: "reflection",
    name: "Monthly accounts",
    message: "Summarise each month's service charge accounts and queries.",
    fragments: 118,
  },
];

export const Default: Story = () => (
  <div className="max-w-xl p-4">
    <ProposedSection
      items={items}
      onOpen={action("onOpen")}
      onDismiss={action("onDismiss")}
    />
  </div>
);
