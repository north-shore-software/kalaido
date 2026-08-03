import type { Story } from "@ladle/react";
import { RotationEmptyState } from "./rotation-empty-state";

export default { title: "Rotation / RotationEmptyState" };

export const Default: Story = () => (
  <div className="p-4 max-w-xl">
    <RotationEmptyState />
  </div>
);
