import type { Story } from "@ladle/react";
import { DangerZoneSection } from "./danger-zone-section";

export default { title: "Settings / DangerZoneSection" };

/** Click Reset to see the confirm step; the reset itself needs the app. */
export const Default: Story = () => (
  <div className="max-w-2xl bg-background p-6">
    <DangerZoneSection />
  </div>
);
