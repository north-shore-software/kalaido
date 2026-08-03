import type { Story } from "@ladle/react";
import { Chip } from "./chip.tsx";

export default { title: "Kalaido / Chip" };

export const Default: Story = () => (
  <div className="flex flex-wrap gap-2 p-4">
    <Chip>All Items</Chip>
    <Chip active>Selected Item</Chip>
  </div>
);

export const CyanAccent: Story = () => (
  <div className="flex flex-wrap gap-2 p-4">
    <Chip accent="cyan">Active Cyan Inactive</Chip>
    <Chip active accent="cyan">
      Active Cyan Active
    </Chip>
  </div>
);
