import type { Story } from "@ladle/react";
import { Mark } from "./brand.tsx";

export default { title: "Kalaido / Brand" };

export const Default: Story = () => (
  <div className="flex items-center gap-2 p-4">
    <Mark />
    <span className="text-sm font-semibold">Kalaido Mark</span>
  </div>
);
