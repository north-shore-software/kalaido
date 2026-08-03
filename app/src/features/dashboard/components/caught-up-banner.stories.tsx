import type { Story } from "@ladle/react";
import { CaughtUpBanner } from "./caught-up-banner";

export default { title: "Dashboard / CaughtUpBanner" };

export const Default: Story = () => {
  return (
    <div className="max-w-xl p-4">
      <CaughtUpBanner />
    </div>
  );
};
