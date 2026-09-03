import type { Story } from "@ladle/react";
import { useState } from "react";
import { SCHEDULE_FIXTURE_1, SCHEDULE_FIXTURE_2 } from "../fixtures.ts";
import { ScheduleChips, SchedulePill } from "./schedule-controls.tsx";

export default { title: "Reflections / ScheduleControls" };

export const ChipsDefault: Story = () => {
  const [freq, setFreq] = useState(SCHEDULE_FIXTURE_1.freq);
  const [win, setWin] = useState(SCHEDULE_FIXTURE_1.win);
  return (
    <div className="w-[300px] border border-line bg-card p-4">
      <ScheduleChips
        freq={freq}
        win={win}
        onChangeFreq={setFreq}
        onChangeWin={setWin}
      />
    </div>
  );
};

export const ChipsCombo2: Story = () => {
  const [freq, setFreq] = useState(SCHEDULE_FIXTURE_2.freq);
  const [win, setWin] = useState(SCHEDULE_FIXTURE_2.win);
  return (
    <div className="w-[300px] border border-line bg-card p-4">
      <ScheduleChips
        freq={freq}
        win={win}
        onChangeFreq={setFreq}
        onChangeWin={setWin}
        freqLabel="Frequency · how often it regenerates"
        winLabel="Lookback window · fragments per run"
        gap="gap-2"
      />
    </div>
  );
};

export const PillVariants: Story = () => {
  return (
    <div className="flex flex-col gap-4 p-4 max-w-[300px]">
      <div>
        <p className="mb-1 text-xs text-fg-3">Default Pill (New Reflection)</p>
        <SchedulePill freq="Weekly" win="7 days · auto-approved" />
      </div>
      <div>
        <p className="mb-1 text-xs text-fg-3">Detail Panel Pill</p>
        <SchedulePill freq="scheduled" win="7d" className="px-2.5 py-2" />
      </div>
    </div>
  );
};
