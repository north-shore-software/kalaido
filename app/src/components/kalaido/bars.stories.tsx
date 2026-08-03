import type { Story } from "@ladle/react";
import { Bar, DocBody, Lines } from "./bars.tsx";

export default { title: "Kalaido / Bars" };

export const SingleBar: Story = () => (
  <div className="flex flex-col gap-4 p-4">
    <Bar w="100%" h={9} />
    <Bar w="75%" h={12} className="bg-surface-2" />
    <Bar w={120} h={16} className="bg-action-wash" />
  </div>
);

export const SeveralLines: Story = () => (
  <div className="max-w-md p-4">
    <Lines widths={["100%", "92%", "85%", "60%"]} h={8} gap={8} />
  </div>
);

export const FauxDocBodyDefault: Story = () => (
  <div className="max-w-xl p-4">
    <DocBody title paragraphs={3} />
  </div>
);

export const FauxDocBodyDense: Story = () => (
  <div className="max-w-xl p-4">
    <DocBody title={false} paragraphs={2} dense />
  </div>
);
