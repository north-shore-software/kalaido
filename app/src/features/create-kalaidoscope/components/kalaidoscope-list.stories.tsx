import type { Story } from "@ladle/react";
import { mockKalaidoscopes, seedKalaidoscopes } from "../fixtures";
import { KalaidoscopeList } from "./kalaidoscope-list";

export default { title: "Create Kalaidoscope / KalaidoscopeList" };

export const Default: Story = () => {
  seedKalaidoscopes();
  return (
    <div className="w-[420px] bg-background p-4">
      <KalaidoscopeList className="flex flex-col" />
    </div>
  );
};

/** The open one is left out, as the recovery screen's switcher does. */
export const ExcludingCurrent: Story = () => {
  seedKalaidoscopes(mockKalaidoscopes, mockKalaidoscopes[0].id);
  return (
    <div className="w-[420px] bg-background p-4">
      <KalaidoscopeList
        className="flex flex-col"
        excludeId={mockKalaidoscopes[0].id}
      />
    </div>
  );
};

/** Nothing to list renders nothing at all. */
export const Empty: Story = () => {
  seedKalaidoscopes([]);
  return (
    <div className="w-[420px] bg-background p-4">
      <KalaidoscopeList className="flex flex-col" />
      <p className="text-body-sm text-fg-3">(renders null)</p>
    </div>
  );
};
