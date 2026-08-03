import type { Story } from "@ladle/react";
import { DiffLine } from "./diff.tsx";

export default { title: "Kalaido / DiffLine" };

export const Default: Story = () => (
  <div className="flex flex-col gap-2 p-4 max-w-sm border border-line rounded-lg bg-card">
    <DiffLine kind="add" width="90%" />
    <DiffLine kind="add" width="80%" />
    <DiffLine kind="del" width="70%" />
    <DiffLine kind="add" width="40%" />
  </div>
);
