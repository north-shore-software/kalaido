import type { Story } from "@ladle/react";
import { KalaidoscopeRow } from "./kalaidoscope-row";

export default { title: "Settings / KalaidoscopeRow" };

const mockKalaidoscope = {
  id: "k-1",
  type: "local_file" as const,
  locator: "/Users/louis/kalaidoscopes/personal",
  displayName: "My Personal Journal",
  icon: "lucide:book-open",
};

export const Active: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <KalaidoscopeRow kalaidoscope={mockKalaidoscope} isActive={true} />
    </div>
  );
};

export const Inactive: Story = () => {
  return (
    <div className="max-w-xl p-4 bg-background border border-line">
      <KalaidoscopeRow kalaidoscope={mockKalaidoscope} isActive={false} />
    </div>
  );
};
