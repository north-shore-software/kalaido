import type { Story } from "@ladle/react";
import { Label, Mono } from "./text.tsx";

export default { title: "Kalaido / Text" };

export const MicroLabel: Story = () => (
  <div className="flex flex-col gap-1 p-4">
    <Label>system status</Label>
    <Label className="text-action-ink">action requested</Label>
  </div>
);

export const MonospaceVoice: Story = () => (
  <div className="flex flex-col gap-1 p-4">
    <Mono>v1.0.3-beta_rev2</Mono>
    <Mono className="text-foreground font-semibold">1,048,576 rows</Mono>
    <Mono className="text-critical">CRITICAL_ERR_TIMEOUT</Mono>
  </div>
);
