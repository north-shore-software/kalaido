import type { Story } from "@ladle/react";
import {
  ContextEmptyState,
  type ContextItem,
  ContextItems,
} from "./context-picker";

export default { title: "Kalaido / ContextPicker" };

const fixtureItems: ContextItem[] = [
  {
    kind: "Colour",
    id: "color-red",
    label: "Crimson Red",
    value: "#ff0000",
  },
  {
    kind: "Type",
    id: "fragment-code",
    label: "Code Fragment",
  },
  {
    kind: "Projection",
    id: "proj-1",
    label: "Main Dashboard Projection",
  },
  {
    kind: "Reflection",
    id: "refl-1",
    label: "Weekly Sync Reflection",
  },
  // An explicitly pinned fragment. Fragments have no names, so the label is a
  // line of their own content — resolved by the picker, not stored in the spec.
  {
    kind: "Fragment",
    id: "frag-1",
    label: "Checkout redesign: the three open questions",
  },
];

export const Items: Story = () => (
  <div className="max-w-xs p-4 bg-background border border-line rounded-lg">
    <ContextItems
      items={fixtureItems}
      onRemove={(item) => console.log("Remove item:", item)}
    />
  </div>
);

export const EmptyState: Story = () => (
  <div className="max-w-xs p-4 bg-background border border-line rounded-lg">
    <ContextEmptyState />
  </div>
);
