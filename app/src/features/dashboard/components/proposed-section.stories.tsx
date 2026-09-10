import type { Story } from "@ladle/react";
import { action } from "@/lib/story-utils.ts";
import type { ProposedItem } from "../types";
import { ProposedSection } from "./proposed-section";

export default { title: "Dashboard / ProposedSection" };

const items: ProposedItem[] = [
  {
    id: "p1",
    kind: "projection",
    name: "Lift maintenance contract",
    message:
      "Keep a current account of the lift maintenance arrangement: who holds the contract, what was quoted and agreed, and what is outstanding.",
    sources: [
      { kind: "Colour", id: "c1", label: "Maintenance", swatch: 3 },
      { kind: "Colour", id: "c2", label: "Contracts", swatch: 0 },
    ],
  },
  {
    id: "r1",
    kind: "reflection",
    name: "Monthly accounts",
    message: "Summarise each month's service charge accounts and queries.",
    sources: [{ kind: "Colour", id: "c3", label: "Accounts", swatch: 5 }],
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
