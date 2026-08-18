import { ScheduleChips } from "@/features/reflections/components/schedule-controls";
import { cn } from "@/lib/css-utils";

export interface RefineConfigPanelProps {
  freq: number;
  onFreqChange: (freq: number) => void;
  win: number;
  onWinChange: (win: number) => void;
  freqLabel?: React.ReactNode;
  winLabel?: React.ReactNode;
  gap?: string;
  className?: string;
}

export function RefineConfigPanel({
  freq,
  onFreqChange,
  win,
  onWinChange,
  freqLabel,
  winLabel,
  gap,
  className,
}: RefineConfigPanelProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ScheduleChips
        freq={freq}
        win={win}
        onChangeFreq={onFreqChange}
        onChangeWin={onWinChange}
        freqLabel={freqLabel}
        winLabel={winLabel}
        gap={gap}
      />
    </div>
  );
}
