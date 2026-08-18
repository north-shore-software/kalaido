import type { Story } from "@ladle/react";
import { useState } from "react";
import { RefineConfigPanel } from "./refine-config-panel";

export default { title: "Reflections / RefineConfigPanel" };

export const Default: Story = () => {
  const [freq, setFreq] = useState(2);
  const [win, setWin] = useState(2);
  return (
    <div className="w-[340px] border border-line bg-card p-4">
      <RefineConfigPanel
        freq={freq}
        onFreqChange={setFreq}
        win={win}
        onWinChange={setWin}
      />
    </div>
  );
};

export const AuthoringStyle: Story = () => {
  const [freq, setFreq] = useState(1);
  const [win, setWin] = useState(1);
  return (
    <div className="w-[322px] border border-line bg-card p-4">
      <RefineConfigPanel
        freq={freq}
        onFreqChange={setFreq}
        win={win}
        onWinChange={setWin}
        freqLabel="Frequency · how often it regenerates"
        winLabel="Lookback window · fragments per run"
        gap="gap-2"
        className="gap-5"
      />
    </div>
  );
};
