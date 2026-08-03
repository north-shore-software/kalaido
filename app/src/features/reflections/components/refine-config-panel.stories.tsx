import type { Story } from "@ladle/react";
import { useState } from "react";
import { RefineConfigPanel } from "./refine-config-panel";
import { Mono } from "@/components/kalaido";

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
      >
        <div className="rounded border border-dashed border-line p-2 text-center text-xs text-fg-3">
          Mock Context Picker (Pure)
        </div>
      </RefineConfigPanel>
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
        contextSubtitle={
          <Mono className="-mt-1.5 text-[10.5px] text-fg-4">
            colours &amp; fragment types only
          </Mono>
        }
        className="gap-5"
      >
        <div className="rounded border border-dashed border-line p-2 text-center text-xs text-fg-3">
          Mock Context Picker (Pure)
        </div>
      </RefineConfigPanel>
    </div>
  );
};
