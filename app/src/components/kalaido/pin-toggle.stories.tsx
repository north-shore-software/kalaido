import type { Story } from "@ladle/react";
import { PinToggle } from "./pin-toggle.tsx";

export default { title: "Kalaido / PinToggle" };

export const PinnedAndUnpinned: Story = () => (
  <div className="flex gap-4 p-4 items-center bg-card border rounded-lg max-w-xs">
    <div className="flex flex-col items-center gap-1">
      <PinToggle
        pinned={false}
        onToggle={() => console.log("Pin toggle clicked!")}
      />
      <span className="text-[10px] text-fg-3">Unpinned</span>
    </div>
    <div className="flex flex-col items-center gap-1">
      <PinToggle
        pinned={true}
        onToggle={() => console.log("Pin toggle clicked!")}
      />
      <span className="text-[10px] text-fg-3">Pinned</span>
    </div>
  </div>
);
