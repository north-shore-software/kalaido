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

export const CustomValues: Story = () => (
  <div className="flex flex-col gap-4 p-4">
    <div className="flex items-center gap-2">
      <ColourSwatch value="bg-rose-500" size={16} />
      <span className="text-xs">Tailwind class: bg-rose-500</span>
    </div>
    <div className="flex items-center gap-2">
      <ColourSwatch value="#10b981" size={16} />
      <span className="text-xs">Hex value: #10b981</span>
    </div>
    <div className="flex items-center gap-2">
      <ColourSwatch value="rgb(59, 130, 246)" size={16} />
      <span className="text-xs">RGB value: rgb(59, 130, 246)</span>
    </div>
  </div>
);
