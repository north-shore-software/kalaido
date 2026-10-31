import type { Story } from "@ladle/react";
import { useState } from "react";
import { toDateInputValue } from "@/features/reflections/schedule";
import { RefineConfigPanel } from "./refine-config-panel";

export default { title: "Reflections / RefineConfigPanel" };

export const Default: Story = () => {
  const [cadence, setCadence] = useState(1);
  const [fromDate, setFromDate] = useState(toDateInputValue(new Date()));
  return (
    <div className="w-[322px] border border-line bg-card p-4">
      <RefineConfigPanel
        cadence={cadence}
        onCadenceChange={setCadence}
        fromDate={fromDate}
        onFromDateChange={setFromDate}
      />
    </div>
  );
};

export const Backfilling: Story = () => {
  const [cadence, setCadence] = useState(0);
  const [fromDate, setFromDate] = useState(
    toDateInputValue(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)),
  );
  return (
    <div className="w-[322px] border border-line bg-card p-4">
      <RefineConfigPanel
        cadence={cadence}
        onCadenceChange={setCadence}
        fromDate={fromDate}
        onFromDateChange={setFromDate}
      />
    </div>
  );
};

export const Existing: Story = () => {
  const [cadence, setCadence] = useState(2);
  return (
    <div className="w-[322px] border border-line bg-card p-4">
      <RefineConfigPanel
        cadence={cadence}
        onCadenceChange={setCadence}
        fromDate="2026-09-15"
        onFromDateChange={() => {}}
        fromDisabled
        fromNote="Fixed once created. Use Backfill on the reflection to summarize further back."
      />
    </div>
  );
};
