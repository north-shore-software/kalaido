import type { Story } from "@ladle/react";
import { QualityWarning } from "./quality-warning";

export default { title: "Settings / QualityWarning" };

export const Default: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <QualityWarning />
    </div>
  );
};
