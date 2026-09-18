import type { Story } from "@ladle/react";
import {
  mockKalaidoscopes,
  seedKalaidoscopes,
} from "@/features/create-kalaidoscope/fixtures";
import { KalaidoscopesSection } from "./kalaidoscopes-section";

export default { title: "Settings / KalaidoscopesSection" };

/** One open kalaidoscope plus two others. The debug panels need a sidecar. */
export const Default: Story = () => {
  seedKalaidoscopes(mockKalaidoscopes, mockKalaidoscopes[0].id);
  return (
    <div className="max-w-2xl bg-background p-6">
      <KalaidoscopesSection />
    </div>
  );
};

/** Only the open one — no "Other scopes" group. */
export const Single: Story = () => {
  seedKalaidoscopes([mockKalaidoscopes[0]], mockKalaidoscopes[0].id);
  return (
    <div className="max-w-2xl bg-background p-6">
      <KalaidoscopesSection />
    </div>
  );
};
