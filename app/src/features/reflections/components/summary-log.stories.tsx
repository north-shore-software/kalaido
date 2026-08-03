import type { Story } from "@ladle/react";
import { SummaryLog } from "./summary-log";
import { FIXTURE_TIMELINE_FEW, FIXTURE_TIMELINE_MANY } from "../fixtures";

export default { title: "Reflections / SummaryLog" };

export const Few: Story = () => {
  return (
    <div className="w-[240px] p-4 bg-background">
      <SummaryLog items={FIXTURE_TIMELINE_FEW} />
    </div>
  );
};

export const Many: Story = () => {
  return (
    <div className="w-[240px] p-4 bg-background">
      <SummaryLog items={FIXTURE_TIMELINE_MANY} />
    </div>
  );
};

export const Empty: Story = () => {
  return (
    <div className="w-[240px] p-4 bg-background">
      <SummaryLog items={[]} />
    </div>
  );
};
