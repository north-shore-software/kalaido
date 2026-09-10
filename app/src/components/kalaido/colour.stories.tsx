import type { Story } from "@ladle/react";
import { ColourSwatch } from "./colour.tsx";

export default { title: "Kalaido / Colour" };

export const DefaultSwatches: Story = () => (
  <div className="flex flex-wrap gap-2 p-4">
    {Array.from({ length: 8 }, (_, i) => i).map((i) => (
      <div key={i} className="flex flex-col items-center gap-1">
        <ColourSwatch c={i} size={24} />
        <span className="text-[10px] text-fg-3">c={i}</span>
      </div>
    ))}
  </div>
);
